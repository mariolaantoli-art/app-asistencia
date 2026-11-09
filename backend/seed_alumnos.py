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

NAMES = """MARIA PILAR BENEITO REIG
LUNA SOFIA CAAMAÑO GARCIA
EULALIA RIBES FAES
ALEJANDRO CASANOVA MARTIN
ESTEFANIA TECLES BLASCO
LOURDES OLCINA FRANCES
MARIA TECLES BLASCO
FRANCISCA BENEITO REIG
LOLITA PASCUAL MIRÓ
Mª CONSUELO FRANCÉS ESTEVE
Mª DOLORES MIRÓ BODÍ
SUSANA PARDO FRANCÉS
JUAN IGNACIO LLOBELL PASCUAL
MAITE PASCUAL TUDELA
M. FRANCISCA MIRÓ BODÍ
CRISTINA LLUC SANZ
Mª CARMEN VAÑÓ CERDÁ
LORENA TUDELA SILVESTRE
PAULINA CALATAYUD ANTOLI
AITOR VAÑÓ CALATAYUD
PILAR FERRANDO REQUENA
JUANA PASCUAL MARTI
AITANA MIRÓ SÁNCHEZ
MARA BAS I BENEITO
ROSARIO ABAD VICENS
TERESA REIG BENEITO
REBECA MARTIN PARRA
MARIA PÉREZ MAYOR
ADELA REVERT CALATAYUD
JOSE VICENTE CALATAYUD MARTI
RAMON REIG BENEITO
Mª PILAR CALATAYUD MARTÍ
ALEJANDRO BERNABEU CALATAYUD
INÉS REIG BENEITO
MARIA CONSUELO ESTEVE BENEITO
SONIA PÉREZ REIG
PILAR CERDÁ BENEITO
IRIS BENEITO BODÍ
RAQUEL DOMENECH CALLEJA
YOLANDA SEVADILLA NAVARRO
Mª GLORIA DOMINGUEZ PAYÁ
CLAUDIA TUDELA SILVESTRE
XELO FRANCÉS FRANCÉS
NEUS ARAGONÉS VERDÚ
REBEKA KURUNCZI
FELICIANA CASTILLO TORREGROSA
MARTA PÉREZ SEGRELLES
PATRIZIA IZQUIERDO MORALES
ELODIA OLCINA SOLER
MARIBEL COLOMER ANTOLÍ
Mª CARMEN BELDA MARTÍNEZ
Mª EUGENIA LLÀCER ARNAU
Mª DEL PILAR CASTILLO CARDENAS
MARIOLA ANTOLÍ CASTILLO
FRANCISCO BENEITO CALBO
VICTOR ANTOLÍ TOMÁS
LAURA GARCÍA VIVANCOS"""


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    added = skipped = 0
    for name in [n.strip() for n in NAMES.splitlines() if n.strip()]:
        if await db.students.find_one({"name": name}):
            skipped += 1
            continue
        s = Student(name=name, bono_type=None, classes_remaining=0, money_remaining=0.0)
        await db.students.insert_one(s.model_dump())
        added += 1
    print(f"added={added} skipped={skipped} total={await db.students.count_documents({})}")
    client.close()


asyncio.run(main())
