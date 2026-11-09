"""Auth (PIN login), route protection and student self-registration (pending -> approve/reject) tests."""
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
def token():
    r = requests.post(f"{API}/auth/login", json={"pin": PIN})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def s(token):
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return sess


@pytest.fixture(scope="module")
def cleanup(s):
    reg_ids, student_ids = [], []
    yield reg_ids, student_ids
    for sid in student_ids:  # reuse module token (login may be locked by lockout test)
        s.delete(f"{API}/students/{sid}")
    if reg_ids:
        _mongo().registrations.delete_many({"id": {"$in": reg_ids}})


def _make_reg(s, cleanup, health="TEST rodilla"):
    name = f"TEST_Reg_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/registrations", json={
        "name": name, "phone": "600123456", "email": "Test_User@Example.com", "health_notes": health})
    assert r.status_code == 201, r.text
    assert r.json() == {"ok": True, "name": name}
    reg = next(x for x in s.get(f"{API}/registrations").json() if x["name"] == name)
    cleanup[0].append(reg["id"])
    return reg


# Auth
class TestAuth:
    def test_login_ok(self):
        r = requests.post(f"{API}/auth/login", json={"pin": PIN})
        assert r.status_code == 200
        d = r.json()
        assert d["token_type"] == "bearer" and isinstance(d["access_token"], str) and len(d["access_token"]) > 20

    def test_login_wrong(self):
        r = requests.post(f"{API}/auth/login", json={"pin": "0000"})
        assert r.status_code == 401 and r.json()["detail"] == "PIN incorrecto"
        # reset failure counter
        assert requests.post(f"{API}/auth/login", json={"pin": PIN}).status_code == 200

    def test_invalid_token(self):
        r = requests.get(f"{API}/students", headers={"Authorization": "Bearer garbage"})
        assert r.status_code == 401


# Route protection
@pytest.mark.parametrize("method,path", [
    ("get", "/students"), ("post", "/students"), ("get", "/attendance"), ("post", "/attendance"),
    ("get", "/summary/monthly?year=2026&month=11"), ("get", "/class-days"), ("get", "/registrations"),
    ("post", "/registrations/x/approve"), ("post", "/registrations/x/reject"), ("delete", "/students/x"),
    ("delete", "/attendance/x"), ("post", "/students/x/renew"),
])
def test_protected_401(method, path):
    r = getattr(requests, method)(f"{API}{path}", json={})
    assert r.status_code == 401, f"{method} {path} -> {r.status_code}"


# Public registration
class TestRegistration:
    def test_bad_email_422(self):
        r = requests.post(f"{API}/registrations", json={"name": "TEST_x", "phone": "600123456", "email": "bad"})
        assert r.status_code == 422

    def test_short_phone_422(self):
        r = requests.post(f"{API}/registrations", json={"name": "TEST_x", "phone": "12", "email": "a@b.com"})
        assert r.status_code == 422

    def test_blank_name_400(self):
        r = requests.post(f"{API}/registrations", json={"name": "   ", "phone": "600123456", "email": "a@b.com"})
        assert r.status_code == 400

    def test_create_listed_pending(self, s, cleanup):
        reg = _make_reg(s, cleanup)
        assert reg["status"] == "pending" and reg["email"] == "test_user@example.com"
        assert reg["phone"] == "600123456" and reg["health_notes"] == "TEST rodilla"
        assert "_id" not in reg

    def test_approve_creates_student(self, s, cleanup):
        reg = _make_reg(s, cleanup)
        r = s.post(f"{API}/registrations/{reg['id']}/approve", json={"bono_type": 10})
        assert r.status_code == 200, r.text
        st = r.json()
        cleanup[1].append(st["id"])
        assert st["name"] == reg["name"] and st["bono_type"] == 10
        assert st["classes_remaining"] == 10 and st["money_remaining"] == 20
        assert st["phone"] == "600123456" and st["email"] == "test_user@example.com" and st["health_notes"] == "TEST rodilla"
        assert all(x["id"] != reg["id"] for x in s.get(f"{API}/registrations").json())
        assert any(x["id"] == st["id"] and x["health_notes"] == "TEST rodilla" for x in s.get(f"{API}/students").json())
        # second approve -> 404, reject after approve -> 404
        assert s.post(f"{API}/registrations/{reg['id']}/approve", json={"bono_type": 5}).status_code == 404
        assert s.post(f"{API}/registrations/{reg['id']}/reject").status_code == 404

    def test_approve_bad_bono_422(self, s, cleanup):
        reg = _make_reg(s, cleanup)
        assert s.post(f"{API}/registrations/{reg['id']}/approve", json={"bono_type": 7}).status_code == 422
        assert any(x["id"] == reg["id"] for x in s.get(f"{API}/registrations").json())

    def test_reject(self, s, cleanup):
        reg = _make_reg(s, cleanup)
        assert s.post(f"{API}/registrations/{reg['id']}/reject").status_code == 200
        assert all(x["id"] != reg["id"] for x in s.get(f"{API}/registrations").json())
        doc = _mongo().registrations.find_one({"id": reg["id"]})
        assert doc and doc["status"] == "rejected"
        assert s.post(f"{API}/registrations/{reg['id']}/reject").status_code == 404

    def test_unknown_404(self, s):
        assert s.post(f"{API}/registrations/nope/approve", json={"bono_type": 5}).status_code == 404


# Brute-force lockout - MUST RUN LAST (locks the IP for 15 min; restart backend afterwards)
def test_zz_lockout_429():
    codes = [requests.post(f"{API}/auth/login", json={"pin": "1111"}).status_code for _ in range(6)]
    assert codes[:5] == [401] * 5, codes
    assert codes[5] == 429, codes
    r = requests.post(f"{API}/auth/login", json={"pin": PIN})
    assert r.status_code == 429 and "Retry-After" in r.headers
