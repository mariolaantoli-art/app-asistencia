import asyncio
import hmac
import secrets
import time
from zoneinfo import ZoneInfo
from collections import defaultdict, deque
from contextlib import suppress
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Query, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.errors import DuplicateKeyError
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone, date, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url, tz_aware=True)
db = client[os.environ['DB_NAME']]

COST_PER_CLASS_STUDENT = 2.0   # Alumno paga 2€
COST_PER_CLASS_SUBSIDY = 2.0   # Ayuntamiento paga 2€
COST_PER_CLASS_TOTAL = COST_PER_CLASS_STUDENT + COST_PER_CLASS_SUBSIDY  # 4€

INDEXES: dict[str, list[IndexModel]] = {
    "students": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("created_at", ASCENDING)], name="created_at_asc"),
    ],
    "attendance": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("student_id", ASCENDING)], name="student_id"),
        IndexModel([("student_id", ASCENDING), ("class_date", ASCENDING)], name="student_date_unique", unique=True),
        IndexModel([("class_date", DESCENDING)], name="class_date_desc"),
        IndexModel([("created_at", DESCENDING)], name="created_at_desc"),
    ],
    "registrations": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)], name="status_created"),
    ],
    "class_day_status": [
        IndexModel([("date", ASCENDING)], name="date", unique=True),
    ],
    "bono_purchases": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)], name="status_created"),
        IndexModel([("student_id", ASCENDING)], name="student_id"),
    ],
}


async def backfill_student_codes() -> None:
    # Si la base de datos está vacía (p. ej. recién publicada), cargar los alumnos ya inscritos, sin bono.
    if await db.students.count_documents({}) == 0:
        from seed_names import NAMES
        base = datetime.now(timezone.utc)
        for i, name in enumerate(NAMES):
            s = Student(name=name, bono_type=None, classes_remaining=0, money_remaining=0.0,
                        created_at=base + timedelta(milliseconds=i))
            await db.students.insert_one(s.model_dump())
        logging.getLogger(__name__).info("Cargados %d alumnos iniciales", len(NAMES))
    # Alumnos antiguos sin código personal: se les asigna uno.
    async for s in db.students.find({"code": {"$exists": False}}, {"_id": 0, "id": 1}):
        await db.students.update_one({"id": s["id"], "code": {"$exists": False}}, {"$set": {"code": _new_code()}})

ADMIN_PIN = os.environ["ADMIN_PIN"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:
                logging.getLogger(__name__).error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)


app = FastAPI()


@app.get("/health", include_in_schema=False)
@app.head("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


# ============ AUTH (PIN del monitor) ============

bearer = HTTPBearer(auto_error=False)

_failures: dict[str, deque] = defaultdict(deque)
_blocked_until: dict[str, float] = {}
LOGIN_WINDOW = 15 * 60
MAX_FAILURES = 5


def _client_key(request: Request) -> str:
    # El ingress AÑADE la IP real al final de X-Forwarded-For; las entradas de la izquierda
    # las puede inventar el cliente, así que usamos la de la derecha.
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


# Tope global de PIN fallidos (todas las IPs): frena la fuerza bruta aunque se roten IPs.
_global_failures: deque = deque()
GLOBAL_MAX_FAILURES = 30


def _global_locked() -> bool:
    now = time.monotonic()
    while _global_failures and _global_failures[0] <= now - LOGIN_WINDOW:
        _global_failures.popleft()
    return len(_global_failures) >= GLOBAL_MAX_FAILURES


_reg_hits: dict[str, deque] = defaultdict(deque)
REG_WINDOW = 60 * 60
REG_MAX = 10


def _check_registration_limit(key: str) -> None:
    now = time.monotonic()
    q = _reg_hits[key]
    while q and q[0] <= now - REG_WINDOW:
        q.popleft()
    if len(q) >= REG_MAX:
        raise HTTPException(status_code=429, detail="Demasiadas inscripciones enviadas. Prueba más tarde")
    q.append(now)


def _check_login_limit(key: str) -> int:
    now = time.monotonic()
    if _blocked_until.get(key, 0) > now:
        return max(1, int(_blocked_until[key] - now))
    q = _failures[key]
    while q and q[0] <= now - LOGIN_WINDOW:
        q.popleft()
    return 0


def _record_failure(key: str) -> None:
    now = time.monotonic()
    q = _failures[key]
    q.append(now)
    while q and q[0] <= now - LOGIN_WINDOW:
        q.popleft()
    if len(q) >= MAX_FAILURES:
        _blocked_until[key] = now + LOGIN_WINDOW


def _make_token() -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": "admin", "role": "admin", "iat": now, "exp": now + timedelta(days=JWT_EXPIRE_DAYS)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def require_admin(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> dict:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="No autenticado")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("sub") != "admin" or payload.get("role") != "admin":
            raise ValueError("claims")
        return payload
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(status_code=401, detail="Sesión caducada, vuelve a entrar")


# Rutas públicas: login + inscripción. El resto exige PIN del monitor.
public_router = APIRouter(prefix="/api")
api_router = APIRouter(prefix="/api", dependencies=[Depends(require_admin)])


class LoginBody(BaseModel):
    pin: str = Field(min_length=4, max_length=32)


@public_router.post("/auth/login")
async def login(body: LoginBody, request: Request):
    key = _client_key(request)
    retry = _check_login_limit(key)
    if retry or _global_locked():
        raise HTTPException(
            status_code=429,
            detail="Demasiados intentos. Prueba de nuevo en unos minutos",
            headers={"Retry-After": str(retry or LOGIN_WINDOW)},
        )
    if not hmac.compare_digest(body.pin.encode(), ADMIN_PIN.encode()):
        _record_failure(key)
        _global_failures.append(time.monotonic())
        raise HTTPException(status_code=401, detail="PIN incorrecto")
    _failures.pop(key, None)
    _blocked_until.pop(key, None)
    return {"access_token": _make_token(), "token_type": "bearer", "expires_in": JWT_EXPIRE_DAYS * 86400}


class RegistrationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=6, max_length=30)
    email: EmailStr
    health_notes: str = Field(default="", max_length=1000)


class Registration(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    phone: str
    email: str
    health_notes: str = ""
    status: Literal["pending", "approved", "rejected"] = "pending"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


@public_router.post("/registrations", status_code=201)
async def create_registration(body: RegistrationCreate, request: Request):
    _check_registration_limit(_client_key(request))
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
    reg = Registration(
        name=name,
        phone=body.phone.strip(),
        email=str(body.email).lower(),
        health_notes=body.health_notes.strip(),
    )
    await db.registrations.insert_one(reg.model_dump())
    # Solo devolvemos confirmación; los datos quedan visibles únicamente para el monitor.
    return {"ok": True, "name": reg.name}


# ============ MODELS ============

BonoType = Literal[5, 10]


def _new_code() -> str:
    return f"{secrets.randbelow(10000):04d}"


def _today_madrid() -> date:
    return datetime.now(ZoneInfo("Europe/Madrid")).date()


class Student(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    bono_type: Optional[BonoType] = None  # 5 clases (10€), 10 clases (20€) o None = sin bono
    classes_remaining: int
    money_remaining: float  # en euros que el alumno aún tiene disponible (2€ por clase)
    phone: str = ""
    email: str = ""
    health_notes: str = ""
    code: str = Field(default_factory=lambda: _new_code())  # código personal de 4 cifras
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StudentCreate(BaseModel):
    name: str
    bono_type: BonoType


class Attendance(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    student_id: str
    student_name: str
    class_date: str  # YYYY-MM-DD
    source: Literal["monitor", "alumno"] = "monitor"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AttendanceCreate(BaseModel):
    student_id: str
    class_date: Optional[str] = None  # si no se da, usa hoy


class MonthlySummaryItem(BaseModel):
    student_id: str
    student_name: str
    classes_attended: int
    student_paid: float      # 2€ * clases
    subsidy_paid: float      # 2€ * clases
    total_cost: float        # 4€ * clases


class MonthlySummary(BaseModel):
    year: int
    month: int
    total_classes: int
    total_student_paid: float
    total_subsidy_paid: float
    total_cost: float
    items: List[MonthlySummaryItem]


# ============ ROUTES ============

@public_router.get("/")
async def root():
    return {"message": "Control de Asistencia API"}


# -------- STUDENTS --------

@api_router.get("/students", response_model=List[Student])
async def list_students():
    docs = await db.students.find({}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return [Student(**d) for d in docs]


@api_router.post("/students", response_model=Student)
async def create_student(payload: StudentCreate):
    if payload.bono_type not in (5, 10):
        raise HTTPException(status_code=400, detail="bono_type debe ser 5 o 10")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
    student = Student(
        name=name,
        bono_type=None,
        classes_remaining=0,
        money_remaining=0.0,
    )
    await db.students.insert_one(student.model_dump())
    await _add_bono(student.id, student.name, payload.bono_type)
    doc = await db.students.find_one({"id": student.id}, {"_id": 0})
    return Student(**doc)


@api_router.delete("/students/{student_id}")
async def delete_student(student_id: str):
    res = await db.students.delete_one({"id": student_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    await db.attendance.delete_many({"student_id": student_id})
    await db.bono_purchases.update_many(
        {"student_id": student_id, "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc), "reason": "alumno eliminado"}},
    )
    return {"ok": True}


class RenewBonoPayload(BaseModel):
    bono_type: BonoType


class BonoPurchase(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    student_id: str
    student_name: str
    bono_type: BonoType  # 5 o 10 clases
    amount: float  # 10€ o 20€
    status: Literal["active", "cancelled"] = "active"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


async def _add_bono(student_id: str, student_name: str, bono_type: int) -> BonoPurchase:
    purchase = BonoPurchase(
        student_id=student_id,
        student_name=student_name,
        bono_type=bono_type,
        amount=bono_type * COST_PER_CLASS_STUDENT,
    )
    await db.students.update_one(
        {"id": student_id},
        {
            "$inc": {"classes_remaining": bono_type, "money_remaining": bono_type * COST_PER_CLASS_STUDENT},
            "$set": {"bono_type": bono_type},
        },
    )
    await db.bono_purchases.insert_one(purchase.model_dump())
    return purchase


async def _remove_bono_classes(student_id: str, classes: int) -> None:
    """Quita las clases de un bono solo si el alumno aún las tiene sin gastar (atómico)."""
    res = await db.students.update_one(
        {"id": student_id, "classes_remaining": {"$gte": classes}},
        {"$inc": {"classes_remaining": -classes, "money_remaining": -classes * COST_PER_CLASS_STUDENT}},
    )
    if res.modified_count == 0:
        raise HTTPException(
            status_code=409,
            detail="El alumno ya ha gastado clases de este bono. Deshaz primero esas asistencias en Historial",
        )


@api_router.post("/students/{student_id}/renew", response_model=Student)
async def renew_bono(student_id: str, payload: RenewBonoPayload):
    student = await db.students.find_one({"id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    await _add_bono(student_id, student["name"], payload.bono_type)
    doc = await db.students.find_one({"id": student_id}, {"_id": 0})
    return Student(**doc)


# -------- BONOS PAGADOS (corregir errores) --------

@api_router.get("/bonos", response_model=List[BonoPurchase])
async def list_bonos(student_id: Optional[str] = None):
    q: dict = {"status": "active"}
    if student_id:
        q["student_id"] = student_id
    docs = await db.bono_purchases.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return [BonoPurchase(**d) for d in docs]


class BonoUpdatePayload(BaseModel):
    bono_type: BonoType
    student_id: str


@api_router.put("/bonos/{bono_id}", response_model=BonoPurchase)
async def update_bono(bono_id: str, payload: BonoUpdatePayload):
    bono = await db.bono_purchases.find_one({"id": bono_id, "status": "active"}, {"_id": 0})
    if not bono:
        raise HTTPException(status_code=404, detail="Bono no encontrado")
    target = await db.students.find_one({"id": payload.student_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    if bono["student_id"] == payload.student_id and bono["bono_type"] == payload.bono_type:
        return BonoPurchase(**bono)

    # 1) "Reservar" el cambio: solo una petición puede pasar del estado antiguo al nuevo
    new_fields = {
        "student_id": payload.student_id,
        "student_name": target["name"],
        "bono_type": payload.bono_type,
        "amount": payload.bono_type * COST_PER_CLASS_STUDENT,
        "updated_at": datetime.now(timezone.utc),
    }
    claimed = await db.bono_purchases.find_one_and_update(
        {"id": bono_id, "status": "active", "student_id": bono["student_id"], "bono_type": bono["bono_type"]},
        {"$set": new_fields},
    )
    if not claimed:
        raise HTTPException(status_code=409, detail="Este bono se acaba de modificar. Vuelve a abrirlo")

    # 2) Ajustar saldos; si falla, deshacer el cambio del bono
    try:
        if bono["student_id"] == payload.student_id:
            diff = payload.bono_type - bono["bono_type"]
            if diff < 0:
                await _remove_bono_classes(payload.student_id, -diff)
            else:
                await db.students.update_one(
                    {"id": payload.student_id},
                    {"$inc": {"classes_remaining": diff, "money_remaining": diff * COST_PER_CLASS_STUDENT}},
                )
        else:
            # Cambio de persona: se retira del alumno equivocado y se da al correcto
            await _remove_bono_classes(bono["student_id"], bono["bono_type"])
            await db.students.update_one(
                {"id": payload.student_id},
                {"$inc": {"classes_remaining": payload.bono_type, "money_remaining": payload.bono_type * COST_PER_CLASS_STUDENT}},
            )
    except HTTPException:
        await db.bono_purchases.update_one(
            {"id": bono_id},
            {"$set": {k: bono[k] for k in ("student_id", "student_name", "bono_type", "amount")}},
        )
        raise
    await db.students.update_one({"id": payload.student_id}, {"$set": {"bono_type": payload.bono_type}})
    doc = await db.bono_purchases.find_one({"id": bono_id}, {"_id": 0})
    return BonoPurchase(**doc)


@api_router.post("/bonos/{bono_id}/cancel")
async def cancel_bono(bono_id: str):
    bono = await db.bono_purchases.find_one_and_update(
        {"id": bono_id, "status": "active"},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)}},
        projection={"_id": 0},
    )
    if not bono:
        raise HTTPException(status_code=404, detail="Bono no encontrado")
    try:
        await _remove_bono_classes(bono["student_id"], bono["bono_type"])
    except HTTPException:
        await db.bono_purchases.update_one({"id": bono_id}, {"$set": {"status": "active"}, "$unset": {"cancelled_at": ""}})
        raise
    return {"ok": True}


# -------- REGISTRATIONS (admin) --------

@api_router.get("/registrations", response_model=List[Registration])
async def list_registrations():
    docs = await db.registrations.find({"status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [Registration(**d) for d in docs]


class ApprovePayload(BaseModel):
    bono_type: BonoType


@api_router.post("/registrations/{reg_id}/approve", response_model=Student)
async def approve_registration(reg_id: str, payload: ApprovePayload):
    reg = await db.registrations.find_one({"id": reg_id, "status": "pending"}, {"_id": 0})
    if not reg:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada o ya gestionada")
    student = Student(
        name=reg["name"],
        bono_type=None,
        classes_remaining=0,
        money_remaining=0.0,
        phone=reg.get("phone", ""),
        email=reg.get("email", ""),
        health_notes=reg.get("health_notes", ""),
    )
    await db.students.insert_one(student.model_dump())
    # Marcar aprobada solo si sigue pendiente (evita dobles aprobaciones simultáneas)
    upd = await db.registrations.update_one(
        {"id": reg_id, "status": "pending"},
        {"$set": {"status": "approved", "resolved_at": datetime.now(timezone.utc), "student_id": student.id}},
    )
    if upd.modified_count == 0:
        await db.students.delete_one({"id": student.id})  # deshacer el alta que acabamos de crear
        raise HTTPException(status_code=404, detail="Solicitud no encontrada o ya gestionada")
    await _add_bono(student.id, student.name, payload.bono_type)
    doc = await db.students.find_one({"id": student.id}, {"_id": 0})
    return Student(**doc)


@api_router.post("/registrations/{reg_id}/reject")
async def reject_registration(reg_id: str):
    res = await db.registrations.update_one(
        {"id": reg_id, "status": "pending"},
        {"$set": {"status": "rejected", "resolved_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada o ya gestionada")
    return {"ok": True}


# -------- ATTENDANCE --------

COURSE_START = date(2026, 10, 1)
COURSE_END = date(2027, 6, 30)
DayStatus = Literal["normal", "festivo", "suspendida"]


def _is_valid_class_date(d: date) -> bool:
    # Martes=1, Jueves=3 (weekday)
    return d.weekday() in (1, 3) and COURSE_START <= d <= COURSE_END


def _parse_date(s: Optional[str]) -> date:
    if not s:
        return _today_madrid()
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido (YYYY-MM-DD)")


async def _cancelled_map() -> dict[str, str]:
    docs = await db.class_day_status.find({"status": {"$ne": "normal"}}, {"_id": 0}).to_list(500)
    return {d["date"]: d["status"] for d in docs}


async def _do_register(student_id: str, cd: date, source: str) -> Attendance:
    student = await db.students.find_one({"id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    if not _is_valid_class_date(cd):
        raise HTTPException(
            status_code=400,
            detail="La fecha debe ser martes o jueves entre octubre 2026 y junio 2027",
        )
    day = await db.class_day_status.find_one({"date": cd.isoformat()}, {"_id": 0})
    if day and day.get("status") in ("festivo", "suspendida"):
        label = "festivo" if day["status"] == "festivo" else "clase suspendida"
        raise HTTPException(status_code=400, detail=f"Ese día está marcado como {label}")
    if student["classes_remaining"] <= 0:
        raise HTTPException(status_code=400, detail="No quedan clases en el bono")
    existing = await db.attendance.find_one({"student_id": student_id, "class_date": cd.isoformat()}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Ya existe asistencia registrada para esa fecha")

    att = Attendance(student_id=student_id, student_name=student["name"], class_date=cd.isoformat(), source=source)
    # Descuento atómico: solo si aún quedan clases
    dec = await db.students.update_one(
        {"id": student_id, "classes_remaining": {"$gt": 0}},
        {"$inc": {"classes_remaining": -1, "money_remaining": -COST_PER_CLASS_STUDENT}},
    )
    if dec.modified_count == 0:
        raise HTTPException(status_code=400, detail="No quedan clases en el bono")
    try:
        await db.attendance.insert_one(att.model_dump())
    except DuplicateKeyError:
        await db.students.update_one(
            {"id": student_id},
            {"$inc": {"classes_remaining": 1, "money_remaining": COST_PER_CLASS_STUDENT}},
        )
        raise HTTPException(status_code=409, detail="Ya existe asistencia registrada para esa fecha")
    return att


@api_router.post("/attendance", response_model=Attendance)
async def register_attendance(payload: AttendanceCreate):
    return await _do_register(payload.student_id, _parse_date(payload.class_date), "monitor")


# -------- ESTADO DE DÍAS (festivo / suspendida) --------

class DayStatusPayload(BaseModel):
    status: DayStatus


@api_router.put("/class-days/{day}")
async def set_day_status(day: str, payload: DayStatusPayload):
    cd = _parse_date(day)
    if not _is_valid_class_date(cd):
        raise HTTPException(status_code=400, detail="No es un día de clase del curso")
    if payload.status != "normal":
        n = await db.attendance.count_documents({"class_date": cd.isoformat()})
        if n:
            raise HTTPException(
                status_code=409,
                detail=f"Ese día ya tiene {n} asistencia(s). Deshazlas en Historial antes de marcarlo",
            )
    await db.class_day_status.update_one(
        {"date": cd.isoformat()},
        {"$set": {"date": cd.isoformat(), "status": payload.status, "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"date": cd.isoformat(), "status": payload.status}


# -------- ZONA ALUMNO (pública, con código personal) --------

_code_failures: dict[str, deque] = defaultdict(deque)
CODE_MAX_FAILURES_STUDENT = 5
CODE_MAX_FAILURES_IP = 30  # varios alumnos comparten la WiFi del gimnasio


def _check_code_limit(key: str) -> None:
    now = time.monotonic()
    q = _code_failures[key]
    while q and q[0] <= now - LOGIN_WINDOW:
        q.popleft()
    limit = CODE_MAX_FAILURES_IP if key.startswith("ip:") else CODE_MAX_FAILURES_STUDENT
    if len(q) >= limit:
        raise HTTPException(status_code=429, detail="Demasiados intentos. Prueba de nuevo en 15 minutos")


async def _verify_student_code(student_id: str, code: str, request: Request) -> dict:
    # Límite por alumno y por IP para que el código de 4 cifras no se pueda adivinar
    keys = [f"s:{student_id}", f"ip:{_client_key(request)}"]
    for k in keys:
        _check_code_limit(k)
    student = await db.students.find_one({"id": student_id}, {"_id": 0})
    if not student or not hmac.compare_digest(str(student.get("code", "")).encode(), code.encode()):
        now = time.monotonic()
        for k in keys:
            _code_failures[k].append(now)
        raise HTTPException(status_code=401, detail="Nombre o código incorrecto")
    return student


class StudentCodePayload(BaseModel):
    student_id: str
    code: str = Field(min_length=4, max_length=4)


class StudentAttendancePayload(StudentCodePayload):
    class_date: str


@public_router.get("/public/students")
async def public_search_students(q: str = Query("", max_length=60)):
    term = q.strip()
    if len(term) < 3:
        return []
    import re
    docs = await db.students.find(
        {"name": {"$regex": re.escape(term), "$options": "i"}}, {"_id": 0, "id": 1, "name": 1}
    ).limit(10).to_list(10)
    return docs


def _student_days(cancelled: dict[str, str]) -> list[str]:
    today = _today_madrid()
    out = []
    cur = COURSE_START
    while cur <= min(today, COURSE_END):
        if cur.weekday() in (1, 3) and cur.isoformat() not in cancelled:
            out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out


@public_router.post("/public/me")
async def public_me(payload: StudentCodePayload, request: Request):
    student = await _verify_student_code(payload.student_id, payload.code, request)
    attended = await db.attendance.find({"student_id": student["id"]}, {"_id": 0, "class_date": 1}).to_list(500)
    return {
        "id": student["id"],
        "name": student["name"],
        "classes_remaining": student["classes_remaining"],
        "money_remaining": student["money_remaining"],
        "attended_dates": sorted({a["class_date"] for a in attended}, reverse=True),
        "available_days": _student_days(await _cancelled_map()),
    }


@public_router.post("/public/attendance")
async def public_register(payload: StudentAttendancePayload, request: Request):
    await _verify_student_code(payload.student_id, payload.code, request)
    cd = _parse_date(payload.class_date)
    if cd > _today_madrid():
        raise HTTPException(status_code=400, detail="Solo puedes registrar clases de hoy o días anteriores")
    att = await _do_register(payload.student_id, cd, "alumno")
    s = await db.students.find_one({"id": payload.student_id}, {"_id": 0})
    return {
        "class_date": att.class_date,
        "classes_remaining": s["classes_remaining"],
        "money_remaining": s["money_remaining"],
    }


@api_router.delete("/attendance/{attendance_id}")
async def delete_attendance(attendance_id: str):
    att = await db.attendance.find_one({"id": attendance_id}, {"_id": 0})
    if not att:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    await db.attendance.delete_one({"id": attendance_id})
    await db.students.update_one(
        {"id": att["student_id"]},
        {"$inc": {"classes_remaining": 1, "money_remaining": COST_PER_CLASS_STUDENT}},
    )
    return {"ok": True}


@api_router.get("/attendance", response_model=List[Attendance])
async def list_attendance(limit: int = Query(10000, ge=1, le=20000)):
    docs = await db.attendance.find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return [Attendance(**d) for d in docs]


# -------- SUMMARY --------

@api_router.get("/summary/monthly", response_model=MonthlySummary)
async def monthly_summary(year: int = Query(...), month: int = Query(..., ge=1, le=12)):
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)

    cursor = db.attendance.find(
        {"class_date": {"$gte": start.isoformat(), "$lt": end.isoformat()}},
        {"_id": 0},
    )
    docs = await cursor.to_list(5000)

    per_student: dict[str, dict] = {}
    for d in docs:
        key = d["student_id"]
        if key not in per_student:
            per_student[key] = {
                "student_id": key,
                "student_name": d["student_name"],
                "classes_attended": 0,
            }
        per_student[key]["classes_attended"] += 1

    items: List[MonthlySummaryItem] = []
    total_classes = 0
    for v in per_student.values():
        c = v["classes_attended"]
        total_classes += c
        items.append(
            MonthlySummaryItem(
                student_id=v["student_id"],
                student_name=v["student_name"],
                classes_attended=c,
                student_paid=round(c * COST_PER_CLASS_STUDENT, 2),
                subsidy_paid=round(c * COST_PER_CLASS_SUBSIDY, 2),
                total_cost=round(c * COST_PER_CLASS_TOTAL, 2),
            )
        )
    items.sort(key=lambda x: x.student_name.lower())

    return MonthlySummary(
        year=year,
        month=month,
        total_classes=total_classes,
        total_student_paid=round(total_classes * COST_PER_CLASS_STUDENT, 2),
        total_subsidy_paid=round(total_classes * COST_PER_CLASS_SUBSIDY, 2),
        total_cost=round(total_classes * COST_PER_CLASS_TOTAL, 2),
        items=items,
    )


# -------- CLASS DAYS --------

@api_router.get("/class-days")
async def class_days():
    """Devuelve todos los días de clase (martes y jueves) entre Oct 2026 y Jun 2027, más los cancelados."""
    start = COURSE_START
    end = COURSE_END
    days = []
    cur = start
    while cur <= end:
        if cur.weekday() in (1, 3):
            days.append(cur.isoformat())
        cur += timedelta(days=1)
    return {"days": days, "count": len(days), "cancelled": await _cancelled_map()}


app.include_router(public_router)
app.include_router(api_router)

# -------- VERSIÓN WEB (abrir la app desde el navegador) --------
WEB_DIR = (ROOT_DIR / "web_app").resolve()


@app.get("/api/app", include_in_schema=False)
@app.get("/api/app/{path:path}", include_in_schema=False)
async def web_app(path: str = ""):
    if not (WEB_DIR / "index.html").exists():
        raise HTTPException(status_code=404, detail="Versión web no disponible")
    if path:
        candidate = (WEB_DIR / path).resolve()
        if candidate.is_relative_to(WEB_DIR) and candidate.is_file():
            return FileResponse(candidate)
    # Rutas de la app (p. ej. /api/app/acceso): se sirve index.html
    return FileResponse(WEB_DIR / "index.html", headers={"Cache-Control": "no-cache"})

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def start_index_build():
    app.state.index_task = asyncio.create_task(ensure_indexes())
    await backfill_student_codes()


@app.on_event("shutdown")
async def shutdown_db_client():
    app.state.index_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.index_task
    client.close()
