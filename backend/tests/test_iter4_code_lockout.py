"""Iteration 4: student code brute-force lockout (per student + per IP). Restart backend after running."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
PIN = "688202"


@pytest.fixture(scope="module")
def s():
    r = requests.post(f"{API}/auth/login", json={"pin": PIN})
    sess = requests.Session()
    sess.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    ids = []
    sess.ids = ids
    yield sess
    for sid in ids:
        sess.delete(f"{API}/students/{sid}")


def _mk(s):
    st = s.post(f"{API}/students", json={"name": f"TEST_It4L_{uuid.uuid4().hex[:6]}", "bono_type": 5}).json()
    s.ids.append(st["id"])
    return st


def test_lockout_per_student_and_ip(s):
    a, b = _mk(s), _mk(s)
    wrong = "0000" if a["code"] != "0000" else "1111"
    codes = [requests.post(f"{API}/public/me", json={"student_id": a["id"], "code": wrong}).status_code for _ in range(5)]
    assert codes == [401] * 5
    # 6th attempt even with correct code -> 429
    assert requests.post(f"{API}/public/me", json={"student_id": a["id"], "code": a["code"]}).status_code == 429
    # IP also locked -> other student with correct code -> 429
    r = requests.post(f"{API}/public/me", json={"student_id": b["id"], "code": b["code"]})
    print("other student same IP:", r.status_code)
    assert r.status_code == 429
    # spoofed leftmost XFF should not bypass
    r = requests.post(f"{API}/public/me", json={"student_id": b["id"], "code": b["code"]}, headers={"X-Forwarded-For": "9.9.9.9"})
    assert r.status_code == 429
