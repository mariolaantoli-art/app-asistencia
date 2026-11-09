"""Control de Asistencia API regression tests (students, attendance, summary, class-days)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture
def student(s):
    created = []

    def _make(bono=5, name="TEST_Alumno"):
        r = s.post(f"{API}/students", json={"name": name, "bono_type": bono})
        assert r.status_code == 200, r.text
        created.append(r.json()["id"])
        return r.json()

    yield _make
    for sid in created:
        s.delete(f"{API}/students/{sid}")


def _get_student(s, sid):
    return next((x for x in s.get(f"{API}/students").json() if x["id"] == sid), None)


# Students CRUD
class TestStudents:
    def test_list(self, s):
        r = s.get(f"{API}/students")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert all("_id" not in x for x in r.json())

    @pytest.mark.parametrize("bono,money", [(5, 10.0), (10, 20.0)])
    def test_create_bonos(self, s, student, bono, money):
        st = student(bono)
        assert st["classes_remaining"] == bono and st["money_remaining"] == money
        got = _get_student(s, st["id"])
        assert got and got["classes_remaining"] == bono

    @pytest.mark.parametrize("bono", [3, 0, 20, "x"])
    def test_create_invalid_bono(self, s, bono):
        r = s.post(f"{API}/students", json={"name": "TEST_bad", "bono_type": bono})
        assert r.status_code in (400, 422)

    def test_create_empty_name(self, s):
        r = s.post(f"{API}/students", json={"name": "   ", "bono_type": 5})
        assert r.status_code == 400

    def test_renew(self, s, student):
        st = student(5)
        r = s.post(f"{API}/students/{st['id']}/renew", json={"bono_type": 10})
        assert r.status_code == 200
        assert r.json()["classes_remaining"] == 15 and r.json()["money_remaining"] == 30.0
        assert _get_student(s, st["id"])["classes_remaining"] == 15

    def test_renew_404(self, s):
        assert s.post(f"{API}/students/nope/renew", json={"bono_type": 5}).status_code == 404

    def test_delete_removes_attendance(self, s):
        st = s.post(f"{API}/students", json={"name": "TEST_del", "bono_type": 5}).json()
        a = s.post(f"{API}/attendance", json={"student_id": st["id"], "class_date": "2026-11-10"})
        assert a.status_code == 200
        assert s.delete(f"{API}/students/{st['id']}").status_code == 200
        assert _get_student(s, st["id"]) is None
        ids = [x["id"] for x in s.get(f"{API}/attendance?limit=2000").json()]
        assert a.json()["id"] not in ids
        assert s.delete(f"{API}/students/{st['id']}").status_code == 404


# Attendance register / validation / undo
class TestAttendance:
    def test_register_and_undo(self, s, student):
        st = student(5)
        r = s.post(f"{API}/attendance", json={"student_id": st["id"], "class_date": "2026-11-10"})
        assert r.status_code == 200
        att = r.json()
        assert att["class_date"] == "2026-11-10" and att["student_name"] == "TEST_Alumno"
        got = _get_student(s, st["id"])
        assert got["classes_remaining"] == 4 and got["money_remaining"] == 8.0
        # duplicate
        d = s.post(f"{API}/attendance", json={"student_id": st["id"], "class_date": "2026-11-10"})
        assert d.status_code == 409
        # undo
        assert s.delete(f"{API}/attendance/{att['id']}").status_code == 200
        got = _get_student(s, st["id"])
        assert got["classes_remaining"] == 5 and got["money_remaining"] == 10.0
        assert s.delete(f"{API}/attendance/{att['id']}").status_code == 404

    @pytest.mark.parametrize("d", ["2026-11-09", "2026-11-11", "2026-09-29", "2027-07-01", "2026-13-01", "bad"])
    def test_invalid_dates(self, s, student, d):
        st = student(5)
        r = s.post(f"{API}/attendance", json={"student_id": st["id"], "class_date": d})
        assert r.status_code == 400
        assert _get_student(s, st["id"])["classes_remaining"] == 5

    @pytest.mark.parametrize("d", ["2026-10-01", "2027-06-29"])
    def test_boundary_dates_valid(self, s, student, d):
        st = student(5)
        r = s.post(f"{API}/attendance", json={"student_id": st["id"], "class_date": d})
        assert r.status_code == 200

    def test_zero_classes(self, s, student):
        st = student(5)
        for d in ["2026-11-10", "2026-11-12", "2026-11-17", "2026-11-19", "2026-11-24"]:
            assert s.post(f"{API}/attendance", json={"student_id": st["id"], "class_date": d}).status_code == 200
        r = s.post(f"{API}/attendance", json={"student_id": st["id"], "class_date": "2026-11-26"})
        assert r.status_code == 400
        got = _get_student(s, st["id"])
        assert got["classes_remaining"] == 0 and got["money_remaining"] == 0.0

    def test_unknown_student(self, s):
        r = s.post(f"{API}/attendance", json={"student_id": "nope", "class_date": "2026-11-10"})
        assert r.status_code == 404


# Monthly summary + class days
class TestSummary:
    def test_monthly(self, s, student):
        before = s.get(f"{API}/summary/monthly?year=2026&month=12").json()
        st = student(10, "TEST_Resumen")
        for d in ["2026-12-01", "2026-12-03", "2026-12-08"]:
            assert s.post(f"{API}/attendance", json={"student_id": st["id"], "class_date": d}).status_code == 200
        r = s.get(f"{API}/summary/monthly?year=2026&month=12")
        assert r.status_code == 200
        data = r.json()
        assert data["total_classes"] == before["total_classes"] + 3
        assert data["total_cost"] == data["total_classes"] * 4
        assert data["total_student_paid"] == data["total_subsidy_paid"] == data["total_classes"] * 2
        item = next(i for i in data["items"] if i["student_id"] == st["id"])
        assert item["classes_attended"] == 3 and item["total_cost"] == 12.0
        assert item["student_paid"] == 6.0 and item["subsidy_paid"] == 6.0

    def test_monthly_invalid_month(self, s):
        assert s.get(f"{API}/summary/monthly?year=2026&month=13").status_code == 422

    def test_class_days(self, s):
        data = s.get(f"{API}/class-days").json()
        import datetime as dt
        assert data["count"] == len(data["days"]) > 0
        assert data["days"][0] == "2026-10-01" and data["days"][-1] == "2027-06-29"
        assert all(dt.date.fromisoformat(d).weekday() in (1, 3) for d in data["days"])
