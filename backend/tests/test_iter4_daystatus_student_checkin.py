"""Iteration 4: class-day status (festivo/suspendida) + student self check-in (public zone with 4-digit code)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
PIN = "688202"  # from /app/memory/test_credentials.md

PAST_SUSP = "2026-10-01"     # Thu, past -> marked suspendida for public reject test
PAST_OK = "2026-10-08"       # Thu, past -> public success
PAST_OK2 = "2026-10-06"      # Tue, past
ADMIN_409_DAY = "2026-10-13" # Tue -> admin attendance then try festivo -> 409
FUT_FEST = "2027-05-04"      # Tue future -> admin festivo test
FUTURE = "2026-11-10"        # Tue, tomorrow


@pytest.fixture(scope="module")
def s():
    r = requests.post(f"{API}/auth/login", json={"pin": PIN})
    assert r.status_code == 200, r.text
    sess = requests.Session()
    sess.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return sess


@pytest.fixture(scope="module")
def ctx(s):
    data = {"students": [], "days": []}
    yield data
    for d in data["days"]:
        s.put(f"{API}/class-days/{d}", json={"status": "normal"})
    for sid in data["students"]:
        s.delete(f"{API}/students/{sid}")


def _mk(s, ctx, bono=5):
    name = f"TEST_It4_{uuid.uuid4().hex[:6]}"
    r = s.post(f"{API}/students", json={"name": name, "bono_type": bono})
    assert r.status_code == 200, r.text
    st = r.json()
    ctx["students"].append(st["id"])
    assert len(st["code"]) == 4 and st["code"].isdigit()
    return st


# ---- codes ----
def test_all_students_have_code(s):
    r = s.get(f"{API}/students")
    assert r.status_code == 200
    assert all(len(x.get("code", "")) == 4 and x["code"].isdigit() for x in r.json())


# ---- class-days status ----
def test_class_days_has_cancelled_map(s):
    r = s.get(f"{API}/class-days")
    assert r.status_code == 200 and isinstance(r.json()["cancelled"], dict)


def test_day_status_requires_admin():
    r = requests.put(f"{API}/class-days/{FUT_FEST}", json={"status": "festivo"})
    assert r.status_code in (401, 403)


def test_day_status_not_class_day(s):
    assert s.put(f"{API}/class-days/2026-11-09", json={"status": "festivo"}).status_code == 400  # Monday
    assert s.put(f"{API}/class-days/2027-07-06", json={"status": "festivo"}).status_code == 400  # out of course
    assert s.put(f"{API}/class-days/bad", json={"status": "festivo"}).status_code == 400
    assert s.put(f"{API}/class-days/{FUT_FEST}", json={"status": "otro"}).status_code == 422


def test_day_status_set_and_admin_reject(s, ctx):
    ctx["days"].append(FUT_FEST)
    r = s.put(f"{API}/class-days/{FUT_FEST}", json={"status": "festivo"})
    assert r.status_code == 200 and r.json() == {"date": FUT_FEST, "status": "festivo"}
    assert s.get(f"{API}/class-days").json()["cancelled"].get(FUT_FEST) == "festivo"
    st = _mk(s, ctx)
    r = s.post(f"{API}/attendance", json={"student_id": st["id"], "class_date": FUT_FEST})
    assert r.status_code == 400 and "festivo" in r.json()["detail"]
    r = s.put(f"{API}/class-days/{FUT_FEST}", json={"status": "suspendida"})
    assert r.status_code == 200
    r = s.post(f"{API}/attendance", json={"student_id": st["id"], "class_date": FUT_FEST})
    assert r.status_code == 400 and "suspendida" in r.json()["detail"]
    # back to normal
    assert s.put(f"{API}/class-days/{FUT_FEST}", json={"status": "normal"}).status_code == 200
    assert FUT_FEST not in s.get(f"{API}/class-days").json()["cancelled"]
    # balance untouched by rejected attempts
    me = [x for x in s.get(f"{API}/students").json() if x["id"] == st["id"]][0]
    assert me["classes_remaining"] == 5


def test_day_status_409_with_attendance(s, ctx):
    st = _mk(s, ctx)
    r = s.post(f"{API}/attendance", json={"student_id": st["id"], "class_date": ADMIN_409_DAY})
    assert r.status_code == 200, r.text
    att_id = r.json()["id"]
    r = s.put(f"{API}/class-days/{ADMIN_409_DAY}", json={"status": "festivo"})
    if r.status_code == 200:
        ctx["days"].append(ADMIN_409_DAY)
    assert r.status_code == 409
    # normal allowed even with attendances
    assert s.put(f"{API}/class-days/{ADMIN_409_DAY}", json={"status": "normal"}).status_code == 200
    assert s.delete(f"{API}/attendance/{att_id}").status_code == 200


# ---- public search ----
def test_public_search(s, ctx):
    st = _mk(s, ctx)
    assert requests.get(f"{API}/public/students", params={"q": "TE"}).json() == []
    r = requests.get(f"{API}/public/students", params={"q": st["name"][5:]})
    assert r.status_code == 200
    res = r.json()
    assert len(res) == 1 and set(res[0].keys()) == {"id", "name"} and res[0]["id"] == st["id"]
    r = requests.get(f"{API}/public/students", params={"q": "ari"})
    assert r.status_code == 200 and len(r.json()) <= 10
    assert all(set(x.keys()) == {"id", "name"} for x in r.json())
    # regex injection safe
    assert requests.get(f"{API}/public/students", params={"q": ".*."}).json() == []


# ---- public me + attendance ----
def test_public_me_and_register_flow(s, ctx):
    st = _mk(s, ctx, bono=5)
    sid, code = st["id"], st["code"]
    r = requests.post(f"{API}/public/me", json={"student_id": sid, "code": code})
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["classes_remaining"] == 5 and me["money_remaining"] == 10
    assert me["attended_dates"] == []
    assert "2026-11-05" in me["available_days"] and FUTURE not in me["available_days"]
    assert all(d <= "2026-11-09" for d in me["available_days"])
    assert "_id" not in me and "code" not in me
    # success
    r = requests.post(f"{API}/public/attendance", json={"student_id": sid, "code": code, "class_date": PAST_OK})
    assert r.status_code == 200, r.text
    assert r.json() == {"class_date": PAST_OK, "classes_remaining": 4, "money_remaining": 8}
    atts = [a for a in s.get(f"{API}/attendance").json() if a["student_id"] == sid]
    assert len(atts) == 1 and atts[0]["source"] == "alumno" and atts[0]["class_date"] == PAST_OK
    # duplicate
    r = requests.post(f"{API}/public/attendance", json={"student_id": sid, "code": code, "class_date": PAST_OK})
    assert r.status_code == 409
    # future
    r = requests.post(f"{API}/public/attendance", json={"student_id": sid, "code": code, "class_date": FUTURE})
    assert r.status_code == 400
    # today (Monday, not class day)
    r = requests.post(f"{API}/public/attendance", json={"student_id": sid, "code": code, "class_date": "2026-11-09"})
    assert r.status_code == 400
    me = requests.post(f"{API}/public/me", json={"student_id": sid, "code": code}).json()
    assert me["attended_dates"] == [PAST_OK] and me["classes_remaining"] == 4


def test_public_register_cancelled_day(s, ctx):
    st = _mk(s, ctx)
    ctx["days"].append(PAST_SUSP)
    assert s.put(f"{API}/class-days/{PAST_SUSP}", json={"status": "suspendida"}).status_code == 200
    me = requests.post(f"{API}/public/me", json={"student_id": st["id"], "code": st["code"]}).json()
    assert PAST_SUSP not in me["available_days"]
    r = requests.post(f"{API}/public/attendance", json={"student_id": st["id"], "code": st["code"], "class_date": PAST_SUSP})
    assert r.status_code == 400 and "suspendida" in r.json()["detail"]
    assert s.put(f"{API}/class-days/{PAST_SUSP}", json={"status": "normal"}).status_code == 200


def test_public_register_no_classes(s, ctx):
    st = _mk(s, ctx, bono=5)
    for d in ["2026-10-06", "2026-10-08", "2026-10-15", "2026-10-20", "2026-10-22"]:
        r = requests.post(f"{API}/public/attendance", json={"student_id": st["id"], "code": st["code"], "class_date": d})
        assert r.status_code == 200, r.text
    r = requests.post(f"{API}/public/attendance", json={"student_id": st["id"], "code": st["code"], "class_date": "2026-10-27"})
    assert r.status_code == 400 and "clases" in r.json()["detail"]


def test_public_wrong_code_and_validation(s, ctx):
    st = _mk(s, ctx)
    wrong = "0000" if st["code"] != "0000" else "1111"
    r = requests.post(f"{API}/public/me", json={"student_id": st["id"], "code": wrong})
    assert r.status_code == 401
    r = requests.post(f"{API}/public/attendance", json={"student_id": st["id"], "code": wrong, "class_date": PAST_OK})
    assert r.status_code == 401
    assert requests.post(f"{API}/public/me", json={"student_id": st["id"], "code": "12"}).status_code == 422
