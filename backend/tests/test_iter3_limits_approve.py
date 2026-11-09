"""Iteration 3: registration rate limit (XFF keyed), approve idempotency, login lockout keyed on X-Forwarded-For."""
import os
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
PIN = "688202"  # from /app/memory/test_credentials.md


def _mongo():
    env = dict(l.strip().split("=", 1) for l in open("/app/backend/.env") if "=" in l and not l.startswith("#"))
    c = MongoClient(env["MONGO_URL"].strip('"'))
    return c[env["DB_NAME"].strip('"')]


@pytest.fixture(scope="module")
def s():
    r = requests.post(f"{API}/auth/login", json={"pin": PIN})
    assert r.status_code == 200, r.text
    sess = requests.Session()
    sess.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return sess


@pytest.fixture(scope="module")
def created(s):
    names, student_ids = [], []
    yield names, student_ids
    db = _mongo()
    for sid in student_ids:
        s.delete(f"{API}/students/{sid}")
    if names:
        db.registrations.delete_many({"name": {"$in": names}})  # only exact names we created


def _reg(created, xff=None):
    name = f"TEST_It3_{uuid.uuid4().hex[:8]}"
    h = {"X-Forwarded-For": xff} if xff else {}
    r = requests.post(f"{API}/registrations", headers=h,
                      json={"name": name, "phone": "600111222", "email": "t@example.com", "health_notes": ""})
    if r.status_code == 201:
        created[0].append(name)
    return r, name


# Approve flow: student inserted, double approve -> 404, no duplicate
class TestApprove:
    def test_double_approve(self, s, created):
        r, name = _reg(created, xff="203.0.113.50")
        assert r.status_code == 201, r.text
        reg = next(x for x in s.get(f"{API}/registrations").json() if x["name"] == name)
        a1 = s.post(f"{API}/registrations/{reg['id']}/approve", json={"bono_type": 10})
        assert a1.status_code == 200, a1.text
        st = a1.json()
        created[1].append(st["id"])
        assert st["classes_remaining"] == 10 and st["money_remaining"] == 20 and st["phone"] == "600111222"
        a2 = s.post(f"{API}/registrations/{reg['id']}/approve", json={"bono_type": 5})
        assert a2.status_code == 404
        studs = [x for x in s.get(f"{API}/students").json() if x["name"] == name]
        assert len(studs) == 1
        doc = _mongo().registrations.find_one({"id": reg["id"]})
        assert doc["status"] == "approved" and doc["student_id"] == st["id"]
        assert reg["id"] not in [x["id"] for x in s.get(f"{API}/registrations").json()]

    def test_concurrent_approve_no_duplicate(self, s, created):
        import concurrent.futures as cf
        r, name = _reg(created, xff="203.0.113.51")
        assert r.status_code == 201
        reg = next(x for x in s.get(f"{API}/registrations").json() if x["name"] == name)
        with cf.ThreadPoolExecutor(5) as ex:
            res = list(ex.map(lambda _: s.post(f"{API}/registrations/{reg['id']}/approve", json={"bono_type": 5}), range(5)))
        codes = sorted(x.status_code for x in res)
        for x in res:
            if x.status_code == 200:
                created[1].append(x.json()["id"])
        assert codes.count(200) == 1, codes
        studs = [x for x in s.get(f"{API}/students").json() if x["name"] == name]
        assert len(studs) == 1, studs

    def test_attendance_regression(self, s, created):
        sid = created[1][0]
        a = s.post(f"{API}/attendance", json={"student_id": sid, "class_date": "2026-10-06"})
        assert a.status_code == 200, a.text
        st = next(x for x in s.get(f"{API}/students").json() if x["id"] == sid)
        assert st["classes_remaining"] == 9
        assert s.post(f"{API}/attendance", json={"student_id": sid, "class_date": "2026-10-06"}).status_code == 409


# Registration rate limit: 10/hour per IP, 11th -> 429
def test_registration_rate_limit(created):
    ip = f"198.51.100.{uuid.uuid4().int % 200 + 1}"
    codes = [_reg(created, xff=ip)[0].status_code for _ in range(11)]
    assert codes[:10] == [201] * 10, codes
    assert codes[10] == 429, codes
    # different IP still allowed
    assert _reg(created, xff="192.0.2.77")[0].status_code == 201


# Lockout - RUN LAST
def test_zz_lockout_429():
    ip = "192.0.2.200"
    h = {"X-Forwarded-For": ip}
    codes = [requests.post(f"{API}/auth/login", headers=h, json={"pin": "1111"}).status_code for _ in range(6)]
    assert codes[:5] == [401] * 5, codes
    assert codes[5] == 429, codes
    r = requests.post(f"{API}/auth/login", headers=h, json={"pin": PIN})
    assert r.status_code == 429 and "Retry-After" in r.headers
    # Other IP (monitor) not locked
    ok = requests.post(f"{API}/auth/login", headers={"X-Forwarded-For": "192.0.2.201"}, json={"pin": PIN})
    assert ok.status_code == 200, ok.text


def test_zzz_lockout_real_ip_no_header():
    """Without a spoofed header: 6 wrong PINs from this machine -> 6th 429."""
    codes = [requests.post(f"{API}/auth/login", json={"pin": "2222"}).status_code for _ in range(6)]
    assert codes[:5] == [401] * 5, codes
    assert codes[5] == 429, codes
