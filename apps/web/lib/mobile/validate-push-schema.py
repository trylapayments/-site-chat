"""Smoke-test the proposed migration in a disposable local database, never the working schema."""
import argparse
from pathlib import Path
import subprocess
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--container", required=True, help="Existing local supabase_db_* container")
args = parser.parse_args()
if not args.container.startswith("supabase_db_"):
    parser.error("Only a local Supabase database container is accepted")
folder = Path(__file__).resolve().parent
repo = folder.parents[3]
database = "mill_mobile_push_qa_" + uuid.uuid4().hex[:12]


def sql(db, body):
    result = subprocess.run(
        ["docker", "exec", "-i", args.container, "psql", "-U", "postgres",
         "-d", db, "-v", "ON_ERROR_STOP=1", "-q"],
        input=body, text=True, capture_output=True, check=True,
    )
    return result.stdout


created = False
try:
    sql("postgres", f"CREATE DATABASE {database} TEMPLATE template0;")
    created = True
    body = (
        (folder / "sql-tests/fixture.sql").read_text()
        + (repo / "supabase/migrations/20261007090000_mobile_push_outbox.sql").read_text()
        + (folder / "sql-tests/assert.sql").read_text()
    )
    print(sql(database, body))
finally:
    if created:
        sql("postgres", f"DROP DATABASE {database} WITH (FORCE);")
        print("Temporary database removed.")
