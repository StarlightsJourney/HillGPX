"""One-time rescue: MongoDB + GridFS -> Supabase, after the self-hosted
backend experiment ended.

Copies the community collections (routes, photos, route_photos, reviews,
reports, route_downloads) and every stored file (gpx, photos, route-thumbs,
avatars) back into the Supabase tables and buckets the site reads. Anything
uploaded while the MongoDB backend ran comes along; the Supabase copy kept
serving the whole time, so rows that already exist are merged, not
duplicated.

Accounts cannot move: MongoDB passwords are PBKDF2 hashes Supabase Auth does
not understand, and Google accounts simply sign in again — a fresh auth user
is created on their next Google sign-in. Routes keep their contributor
credit text; the `user_id` owner link is dropped (no matching auth user).

    MONGO_URI=mongodb://localhost:27017 \
    SUPABASE_URL=https://dzpgnebkyubeptitzjlj.supabase.co \
    SUPABASE_SERVICE_KEY=... \
    python3 scripts/migrate_from_mongo.py [--dry-run]

Needs the *service-role* key — it must write pending/rejected rows and files
past the public upload policies. Put it in .env.local or the shell, never in
a committed file. Requires `pymongo` and `requests` (scripts/requirements.txt).

Idempotent: tables upsert on their natural key, files upload with upsert, so
a re-run after failure resumes cleanly.
"""

import argparse
import json
import os
import sys
import uuid

import requests
from dotenv import load_dotenv
from pymongo import MongoClient
from gridfs import GridFS

load_dotenv(".env.local")
load_dotenv()

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.environ.get("MONGO_DB", "hillgpx")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# collection -> (supabase table, upsert column). Routes upsert on slug; the
# others carry a client-made uuid in `id`.
TABLES = {
    "routes": ("routes", "slug"),
    "photos": ("photos", "id"),
    "route_photos": ("route_photos", "id"),
    "reviews": ("reviews", "id"),
    "reports": ("reports", "id"),
    "route_downloads": ("route_downloads", "slug"),
}
BUCKETS = ("gpx", "photos", "route-thumbs", "avatars")
# Mongo-only fields that have no Supabase column.
DROP = {"_id", "id"}


def headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", **(extra or {})}


def is_uuid(text: object) -> bool:
    try:
        uuid.UUID(str(text))
        return True
    except (ValueError, AttributeError):
        return False


def migrate_table(db, collection: str, table: str, key: str, dry_run: bool) -> str:
    rows = []
    for doc in db[collection].find():
        row = {k: v for k, v in doc.items() if k not in DROP or (k == "id" and is_uuid(v))}
        # user_id points at a Mongo account that no longer exists — drop the link.
        row.pop("user_id", None)
        rows.append(row)
    if dry_run:
        return f"{collection}: {len(rows)} rows (dry run)"
    if rows:
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={key}",
            headers=headers({"Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}),
            # default=str flattens ObjectIds and datetimes into ISO text.
            data=json.dumps(rows, default=str),
            timeout=120,
        )
        if not resp.ok:
            return f"{collection}: FAILED {resp.status_code} {resp.text[:300]}"
    return f"{collection}: {len(rows)} rows upserted"


def migrate_bucket(fs: GridFS, db, bucket: str, dry_run: bool) -> str:
    files = list(db["fs.files"].find({"metadata.bucket": bucket}))
    if dry_run:
        return f"{bucket}: {len(files)} objects (dry run)"
    stored = failed = 0
    for f in files:
        path = f["metadata"]["path"]
        content_type = f["metadata"].get("content_type", "application/octet-stream")
        try:
            data = fs.get(f["_id"]).read()
            resp = requests.post(
                f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}",
                headers=headers({"Content-Type": content_type, "x-upsert": "true"}),
                data=data,
                timeout=300,
            )
            if resp.ok:
                stored += 1
            else:
                failed += 1
                print(f"  {bucket}/{path}: {resp.status_code} {resp.text[:200]}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001 — keep going, report at the end
            failed += 1
            print(f"  {bucket}/{path}: {e}", file=sys.stderr)
    suffix = f", {failed} failed" if failed else ""
    return f"{bucket}: {len(files)} objects, {stored} stored{suffix}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="count rows/files without writing")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (service-role, not publishable).")

    mongo = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    db = mongo[MONGO_DB]
    fs = GridFS(db)
    mongo.admin.command("ping")

    for collection, (table, key) in TABLES.items():
        print(migrate_table(db, collection, table, key, args.dry_run))
    for bucket in BUCKETS:
        print(migrate_bucket(fs, db, bucket, args.dry_run))
    print("Accounts are not migrated — MongoDB password hashes are not portable;")
    print("members sign up again, or straight in with Google.")


if __name__ == "__main__":
    main()
