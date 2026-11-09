"""Alta inicial de alumnos ya inscritos, sin bono (0 clases). Idempotente: salta nombres existentes."""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).parent / ".env")
import sys
sys.path.insert(0, str(Path(__file__).parent))
from server import Student  # noqa: E402

from seed_names import NAMES  # noqa: E402


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    added = skipped = 0
    for name in NAMES:
        if await db.students.find_one({"name": name}):
            skipped += 1
            continue
        s = Student(name=name, bono_type=None, classes_remaining=0, money_remaining=0.0)
        await db.students.insert_one(s.model_dump())
        added += 1
    print(f"added={added} skipped={skipped} total={await db.students.count_documents({})}")
    client.close()


asyncio.run(main())
