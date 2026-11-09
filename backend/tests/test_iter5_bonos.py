"""Iteration 5: bono_purchases records + GET/PUT/cancel /api/bonos (corregir pagos). Uses only TEST_ students."""
import os
import uuid
import concurrent.futures as cf
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
PIN = "688202"  # from /app/memory/test_credentials.md
CLASS_DATE = "2026-10-06"


def _mongo():
    env = dict(l.strip().split("=", 1) for l in open("/app/backend/.env") if "=" in l and not l.startswith("#"))
    return MongoClient(env["MONGO_URL"].strip('"'))[env["DB_NAME"].strip('"')]


@pytest.fixture(scope="module")
def s():
    r = requests.post(f"{API}/auth/login", json={"pin": PIN})
    assert r.status_code == 200, r.text
    sess = requests.Session()
    sess.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return sess


@pytest.fixture(scope="module")
def made(s):
    ids, reg_names = [], []
    yield ids, reg_names
    db = _mongo()
    for sid in ids:
        s.delete(f"{API}/students/{sid}")
        db.bono_purchases.delete_many({"student_id": sid})
    if reg_names:
        db.registrations.delete_many({"name": {"$in": reg_names}})


def _student(s, made, bono=5):
    r = s.post(f"{API}/students", json={"name": f"TEST_B5_{uuid.uuid4().hex[:6]}", "bono_type": bono})
    assert r.status_code == 200, r.text
    made[0].append(r.json()["id"])
    return r.json()


def _get(s, sid):
    return next(x for x in s.get(f"{API}/students").json() if x["id"] == sid)


def _bonos(s, sid):
    r = s.get(f"{API}/bonos", params={"student_id": sid})
    assert r.status_code == 200
    return r.json()


# Auth required
def test_bonos_requires_auth():
    assert requests.get(f"{API}/bonos").status_code in (401, 403)
    assert requests.put(f"{API}/bonos/x", json={"student_id": "x", "bono_type": 5}).status_code in (401, 403)
    assert requests.post(f"{API}/bonos/x/cancel").status_code in (401, 403)


# Create student -> bono record
def test_create_creates_purchase(s, made):
    st = _student(s, made, 10)
    b = _bonos(s, st["id"])
    assert len(b) == 1 and b[0]["bono_type"] == 10 and b[0]["amount"] == 20.0
    assert b[0]["status"] == "active" and b[0]["student_name"] == st["name"] and "_id" not in b[0]


# Renew -> new purchase, newest first in global list
def test_renew_creates_purchase_newest_first(s, made):
    st = _student(s, made, 5)
    r = s.post(f"{API}/students/{st['id']}/renew", json={"bono_type": 10})
    assert r.status_code == 200 and r.json()["classes_remaining"] == 15
    b = _bonos(s, st["id"])
    assert [x["bono_type"] for x in b] == [10, 5]
    allb = s.get(f"{API}/bonos").json()
    assert allb[0]["id"] == b[0]["id"]
    dates = [x["created_at"] for x in allb]
    assert dates == sorted(dates, reverse=True)


# Approve registration -> purchase
def test_approve_creates_purchase(s, made):
    name = f"TEST_B5reg_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/registrations", headers={"X-Forwarded-For": f"10.9.{uuid.uuid4().int % 250}.7"},
                      json={"name": name, "phone": "600111222", "email": "t@example.com", "health_notes": ""})
    assert r.status_code == 201, r.text
    made[1].append(name)
    reg = next(x for x in s.get(f"{API}/registrations").json() if x["name"] == name)
    a = s.post(f"{API}/registrations/{reg['id']}/approve", json={"bono_type": 5})
    assert a.status_code == 200, a.text
    made[0].append(a.json()["id"])
    b = _bonos(s, a.json()["id"])
    assert len(b) == 1 and b[0]["bono_type"] == 5 and b[0]["amount"] == 10.0


# PUT same student 5->10 and 10->5
def test_update_type_same_student(s, made):
    st = _student(s, made, 5)
    bid = _bonos(s, st["id"])[0]["id"]
    r = s.put(f"{API}/bonos/{bid}", json={"student_id": st["id"], "bono_type": 10})
    assert r.status_code == 200 and r.json()["amount"] == 20.0 and r.json()["bono_type"] == 10
    g = _get(s, st["id"])
    assert g["classes_remaining"] == 10 and g["money_remaining"] == 20.0
    r = s.put(f"{API}/bonos/{bid}", json={"student_id": st["id"], "bono_type": 5})
    assert r.status_code == 200 and r.json()["amount"] == 10.0
    g = _get(s, st["id"])
    assert g["classes_remaining"] == 5 and g["money_remaining"] == 10.0
    # no-op
    assert s.put(f"{API}/bonos/{bid}", json={"student_id": st["id"], "bono_type": 5}).status_code == 200
    assert _get(s, st["id"])["classes_remaining"] == 5


# 10->5 when fewer than 5 remain -> 409, unchanged
def test_update_10_to_5_spent_409(s, made):
    st = _student(s, made, 10)
    bid = _bonos(s, st["id"])[0]["id"]
    s.post(f"{API}/students/{st['id']}/renew", json={"bono_type": 5})  # 15 total
    # spend so remaining < 5: drop 11 via attendance not possible on one date; use direct cancel of renew instead
    other = _bonos(s, st["id"])[0]["id"]
    assert s.post(f"{API}/bonos/{other}/cancel").status_code == 200  # back to 10
    a = s.post(f"{API}/attendance", json={"student_id": st["id"], "class_date": CLASS_DATE})
    assert a.status_code == 200, a.text  # now 9
    # 10->5 needs 5 remaining -> 9 ok; force low remaining via db on TEST_ student
    _mongo().students.update_one({"id": st["id"]}, {"$set": {"classes_remaining": 3, "money_remaining": 6.0}})
    r = s.put(f"{API}/bonos/{bid}", json={"student_id": st["id"], "bono_type": 5})
    assert r.status_code == 409 and "gastado" in r.json()["detail"]
    assert _get(s, st["id"])["classes_remaining"] == 3
    assert _bonos(s, st["id"])[0]["bono_type"] == 10


# PUT other student: moves classes
def test_update_move_student(s, made):
    a = _student(s, made, 5)
    b = _student(s, made, 5)
    bid = _bonos(s, a["id"])[0]["id"]
    r = s.put(f"{API}/bonos/{bid}", json={"student_id": b["id"], "bono_type": 10})
    assert r.status_code == 200, r.text
    assert r.json()["student_id"] == b["id"] and r.json()["student_name"] == b["name"] and r.json()["amount"] == 20.0
    assert _get(s, a["id"])["classes_remaining"] == 0 and _get(s, a["id"])["money_remaining"] == 0
    gb = _get(s, b["id"])
    assert gb["classes_remaining"] == 15 and gb["money_remaining"] == 30.0
    assert len(_bonos(s, a["id"])) == 0 and len(_bonos(s, b["id"])) == 2


# PUT other student when old spent -> 409, nothing changes
def test_update_move_spent_409(s, made):
    a = _student(s, made, 5)
    b = _student(s, made, 5)
    bid = _bonos(s, a["id"])[0]["id"]
    assert s.post(f"{API}/attendance", json={"student_id": a["id"], "class_date": CLASS_DATE}).status_code == 200
    r = s.put(f"{API}/bonos/{bid}", json={"student_id": b["id"], "bono_type": 5})
    assert r.status_code == 409
    assert _get(s, a["id"])["classes_remaining"] == 4 and _get(s, b["id"])["classes_remaining"] == 5


# PUT 404s and validation
def test_update_errors(s, made):
    a = _student(s, made, 5)
    bid = _bonos(s, a["id"])[0]["id"]
    assert s.put(f"{API}/bonos/nope", json={"student_id": a["id"], "bono_type": 5}).status_code == 404
    assert s.put(f"{API}/bonos/{bid}", json={"student_id": "nope", "bono_type": 5}).status_code == 404
    assert s.put(f"{API}/bonos/{bid}", json={"student_id": a["id"], "bono_type": 7}).status_code == 422
    assert _get(s, a["id"])["classes_remaining"] == 5


# Cancel: unspent ok, soft delete, disappears; second cancel 404; spent 409
def test_cancel(s, made):
    a = _student(s, made, 10)
    bid = _bonos(s, a["id"])[0]["id"]
    r = s.post(f"{API}/bonos/{bid}/cancel")
    assert r.status_code == 200 and r.json()["ok"] is True
    assert _get(s, a["id"])["classes_remaining"] == 0 and _get(s, a["id"])["money_remaining"] == 0
    assert _bonos(s, a["id"]) == []
    doc = _mongo().bono_purchases.find_one({"id": bid})
    assert doc and doc["status"] == "cancelled"
    assert s.post(f"{API}/bonos/{bid}/cancel").status_code == 404
    assert s.put(f"{API}/bonos/{bid}", json={"student_id": a["id"], "bono_type": 5}).status_code == 404
    b = _student(s, made, 5)
    bb = _bonos(s, b["id"])[0]["id"]
    s.post(f"{API}/attendance", json={"student_id": b["id"], "class_date": CLASS_DATE})
    r = s.post(f"{API}/bonos/{bb}/cancel")
    assert r.status_code == 409
    assert _get(s, b["id"])["classes_remaining"] == 4 and len(_bonos(s, b["id"])) == 1


# Race: concurrent cancels of same bono must remove classes only once
def test_concurrent_cancel_race(s, made):
    a = _student(s, made, 5)
    for _ in range(3):
        s.post(f"{API}/students/{a['id']}/renew", json={"bono_type": 5})  # 20 classes
    bid = _bonos(s, a["id"])[-1]["id"]
    with cf.ThreadPoolExecutor(5) as ex:
        res = list(ex.map(lambda _: s.post(f"{API}/bonos/{bid}/cancel").status_code, range(5)))
    assert res.count(200) == 1, res
    assert _get(s, a["id"])["classes_remaining"] == 15


# Race: concurrent move of same bono to another student must be applied once
def test_concurrent_move_race(s, made):
    a = _student(s, made, 5)
    s.post(f"{API}/students/{a['id']}/renew", json={"bono_type": 5})  # 10
    b = _student(s, made, 5)
    bid = _bonos(s, a["id"])[-1]["id"]
    with cf.ThreadPoolExecutor(5) as ex:
        list(ex.map(lambda _: s.put(f"{API}/bonos/{bid}", json={"student_id": b["id"], "bono_type": 5}), range(5)))
    assert _get(s, a["id"])["classes_remaining"] == 5
    assert _get(s, b["id"])["classes_remaining"] == 10


# Orphan purchases after deleting a student
def test_delete_student_orphans_bonos(s, made):
    a = _student(s, made, 5)
    bid = _bonos(s, a["id"])[0]["id"]
    s.delete(f"{API}/students/{a['id']}")
    ids = [x["id"] for x in s.get(f"{API}/bonos").json()]
    assert bid not in ids, "bono of deleted student still listed in /bonos"
