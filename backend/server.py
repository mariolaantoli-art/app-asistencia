import asyncio
from contextlib import suppress
from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.errors import DuplicateKeyError
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
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
}


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


api_router = APIRouter(prefix="/api")


# ============ MODELS ============

BonoType = Literal[5, 10]


class Student(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    bono_type: BonoType  # 5 clases (10€) o 10 clases (20€)
    classes_remaining: int
    money_remaining: float  # en euros que el alumno aún tiene disponible (2€ por clase)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StudentCreate(BaseModel):
    name: str
    bono_type: BonoType


class Attendance(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    student_id: str
    student_name: str
    class_date: str  # YYYY-MM-DD
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

@api_router.get("/")
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
        bono_type=payload.bono_type,
        classes_remaining=payload.bono_type,
        money_remaining=payload.bono_type * COST_PER_CLASS_STUDENT,
    )
    await db.students.insert_one(student.model_dump())
    return student


@api_router.delete("/students/{student_id}")
async def delete_student(student_id: str):
    res = await db.students.delete_one({"id": student_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    await db.attendance.delete_many({"student_id": student_id})
    return {"ok": True}


class RenewBonoPayload(BaseModel):
    bono_type: BonoType


@api_router.post("/students/{student_id}/renew", response_model=Student)
async def renew_bono(student_id: str, payload: RenewBonoPayload):
    student = await db.students.find_one({"id": student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    new_classes = student["classes_remaining"] + payload.bono_type
    new_money = student["money_remaining"] + payload.bono_type * COST_PER_CLASS_STUDENT
    await db.students.update_one(
        {"id": student_id},
        {"$set": {
            "bono_type": payload.bono_type,
            "classes_remaining": new_classes,
            "money_remaining": new_money,
        }},
    )
    doc = await db.students.find_one({"id": student_id}, {"_id": 0})
    return Student(**doc)


# -------- ATTENDANCE --------

def _is_valid_class_date(d: date) -> bool:
    # Martes=1, Jueves=3 (weekday)
    if d.weekday() not in (1, 3):
        return False
    start = date(2026, 10, 1)
    end = date(2027, 6, 30)
    return start <= d <= end


@api_router.post("/attendance", response_model=Attendance)
async def register_attendance(payload: AttendanceCreate):
    student = await db.students.find_one({"id": payload.student_id}, {"_id": 0})
    if not student:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    if student["classes_remaining"] <= 0:
        raise HTTPException(status_code=400, detail="El alumno no tiene clases en su bono")

    if payload.class_date:
        try:
            cd = date.fromisoformat(payload.class_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato de fecha inválido (YYYY-MM-DD)")
    else:
        cd = date.today()

    # Permitir registrar en el día aunque sea fuera de rango si el usuario insiste, pero por defecto validar
    if not _is_valid_class_date(cd):
        raise HTTPException(
            status_code=400,
            detail="La fecha debe ser martes o jueves entre octubre 2026 y junio 2027",
        )

    # Evitar duplicado mismo alumno misma fecha
    existing = await db.attendance.find_one(
        {"student_id": payload.student_id, "class_date": cd.isoformat()}, {"_id": 0}
    )
    if existing:
        raise HTTPException(status_code=409, detail="Ya existe asistencia registrada para esa fecha")

    att = Attendance(
        student_id=payload.student_id,
        student_name=student["name"],
        class_date=cd.isoformat(),
    )
    # Descuento atómico: solo si aún quedan clases
    dec = await db.students.update_one(
        {"id": payload.student_id, "classes_remaining": {"$gt": 0}},
        {"$inc": {"classes_remaining": -1, "money_remaining": -COST_PER_CLASS_STUDENT}},
    )
    if dec.modified_count == 0:
        raise HTTPException(status_code=400, detail="El alumno no tiene clases en su bono")
    try:
        await db.attendance.insert_one(att.model_dump())
    except DuplicateKeyError:
        await db.students.update_one(
            {"id": payload.student_id},
            {"$inc": {"classes_remaining": 1, "money_remaining": COST_PER_CLASS_STUDENT}},
        )
        raise HTTPException(status_code=409, detail="Ya existe asistencia registrada para esa fecha")
    return att


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
    """Devuelve todos los días de clase (martes y jueves) entre Oct 2026 y Jun 2027."""
    start = date(2026, 10, 1)
    end = date(2027, 6, 30)
    days = []
    cur = start
    while cur <= end:
        if cur.weekday() in (1, 3):
            days.append(cur.isoformat())
        cur += timedelta(days=1)
    return {"days": days, "count": len(days)}


app.include_router(api_router)

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


@app.on_event("shutdown")
async def shutdown_db_client():
    app.state.index_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.index_task
    client.close()
