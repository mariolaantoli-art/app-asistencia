"""Manual race-condition check: concurrent duplicate attendance registration."""
import os
import requests
from concurrent.futures import ThreadPoolExecutor

API = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
st = requests.post(f"{API}/students", json={"name": "TEST_race", "bono_type": 5}).json()
try:
    def reg(_):
        return requests.post(f"{API}/attendance", json={"student_id": st["id"], "class_date": "2026-11-10"}).status_code
    with ThreadPoolExecutor(10) as ex:
        codes = list(ex.map(reg, range(10)))
    print("codes:", codes)
    s2 = next(x for x in requests.get(f"{API}/students").json() if x["id"] == st["id"])
    print("classes_remaining after concurrent same-day:", s2["classes_remaining"])
    # concurrent different days with 1 class left
    st2 = requests.post(f"{API}/students", json={"name": "TEST_race2", "bono_type": 5}).json()
    for d in ["2026-11-10", "2026-11-12", "2026-11-17", "2026-11-19"]:
        requests.post(f"{API}/attendance", json={"student_id": st2["id"], "class_date": d})
    days = ["2026-11-24", "2026-11-26", "2026-12-01", "2026-12-03", "2026-12-08"]
    with ThreadPoolExecutor(5) as ex:
        codes2 = list(ex.map(lambda d: requests.post(f"{API}/attendance", json={"student_id": st2["id"], "class_date": d}).status_code, days))
    s3 = next(x for x in requests.get(f"{API}/students").json() if x["id"] == st2["id"])
    print("codes2:", codes2, "classes_remaining (1 left, 5 concurrent):", s3["classes_remaining"])
    requests.delete(f"{API}/students/{st2['id']}")
finally:
    requests.delete(f"{API}/students/{st['id']}")
