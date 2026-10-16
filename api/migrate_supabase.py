"""One-time migration: Supabase -> MongoDB + GridFS, fully async.

Copies the community tables (reviews, photos, route_photos, reports, routes)
and every object in the storage buckets (photos, gpx, route-thumbs) into the
same shapes api/main.py reads. Tables are fetched concurrently, and bucket
objects download+store in parallel (CONCURRENCY per bucket).

Needs a *service-role* key — the publishable key can only see approved rows,
and this script must move pending/rejected ones too. Put it in .env.local or
the shell, never in a committed file:

    SUPABASE_URL=https://dzpgnebkyubeptitzjlj.supabase.co \
    SUPABASE_SERVICE_KEY=... \
    MONGO_URI=mongodb://localhost:27017 \
    python3 migrate_supabase.py [--dry-run]

Idempotent: rows upsert by `id`/`slug`, files skip by (bucket, path), so a
re-run after failure resumes without duplicates.
"""

import argparse
import asyncio
import os
import sys

import httpx
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from pymongo import ReplaceOne

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.environ.get("MONGO_DB", "hillgpx")

TABLES = ("reviews", "photos", "route_photos", "reports", "routes")
BUCKETS = ("photos", "gpx", "route-thumbs")
PAGE = 1000
CONCURRENCY = int(os.environ.get("MIGRATE_CONCURRENCY", "16"))

UNIQUE = {
    "reviews": "id",
    "photos": "id",
    "route_photos": "id",
    "reports": "id",
    "routes": "slug",
}


def headers() -> dict[str, str]:
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}


async def fetch_table(client: httpx.AsyncClient, table: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers={**headers(), "Range": f"{offset}-{offset + PAGE - 1}"},
            params={"select": "*"},
        )
        resp.raise_for_status()
        batch = resp.json()
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        offset += PAGE


async def list_bucket(client: httpx.AsyncClient, bucket: str) -> list[str]:
    """Recursively list every object path in a storage bucket."""
    paths: list[str] = []
    queue = [""]
    while queue:
        prefix = queue.pop()
        offset = 0
        while True:
            resp = await client.post(
                f"{SUPABASE_URL}/storage/v1/object/list/{bucket}",
                json={
                    "prefix": prefix,
                    "limit": PAGE,
                    "offset": offset,
                    "sortBy": {"column": "name", "order": "asc"},
                },
            )
            resp.raise_for_status()
            items = resp.json()
            if not items:
                break
            for item in items:
                name = item["name"] if not prefix else f"{prefix}/{item['name']}"
                # Folders have no id in the list response.
                if item.get("id") is None:
                    queue.append(name)
                else:
                    paths.append(name)
            if len(items) < PAGE:
                break
            offset += PAGE
    return paths


async def migrate_table(db, client: httpx.AsyncClient, table: str, dry_run: bool) -> str:
    rows = await fetch_table(client, table)
    if not dry_run:
        coll = db[table]
        key = UNIQUE[table]
        ops = []
        for row in rows:
            if key not in row:
                continue
            row.setdefault("status", "approved" if table == "routes" else "pending")
            ops.append(ReplaceOne({key: row[key]}, row, upsert=True))
        if ops:
            await coll.bulk_write(ops, ordered=False)
    return f"{table}: {len(rows)} rows" + (" (dry run)" if dry_run else " upserted")


async def migrate_bucket(fs, client: httpx.AsyncClient, bucket: str, dry_run: bool) -> str:
    try:
        paths = await list_bucket(client, bucket)
    except httpx.HTTPStatusError as e:
        return f"{bucket}: cannot list ({e}) — skipped"
    if dry_run:
        return f"{bucket}: {len(paths)} objects (dry run)"

    sem = asyncio.Semaphore(CONCURRENCY)
    stored = 0
    lock = asyncio.Lock()

    async def one(path: str) -> None:
        nonlocal stored
        async with sem:
            if await fs.find({"metadata.bucket": bucket, "metadata.path": path}).to_list(1):
                return
            resp = await client.get(f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}")
            resp.raise_for_status()
            await fs.upload_from_stream(
                path,
                resp.content,
                metadata={
                    "bucket": bucket,
                    "path": path,
                    "content_type": resp.headers.get("Content-Type", "application/octet-stream"),
                },
            )
            async with lock:
                stored += 1

    results = await asyncio.gather(*(one(p) for p in paths), return_exceptions=True)
    failures = sum(isinstance(r, Exception) for r in results)
    suffix = f", {failures} failed" if failures else ""
    return f"{bucket}: {len(paths)} objects, {stored} stored{suffix}"


async def run(dry_run: bool) -> None:
    mongo = AsyncIOMotorClient(MONGO_URI)
    db = mongo[MONGO_DB]
    fs = AsyncIOMotorGridFSBucket(db)

    async with httpx.AsyncClient(headers=headers(), timeout=120) as client:
        table_results, bucket_results = await asyncio.gather(
            asyncio.gather(*(migrate_table(db, client, t, dry_run) for t in TABLES)),
            asyncio.gather(*(migrate_bucket(fs, client, b, dry_run) for b in BUCKETS)),
        )
    for line in (*table_results, *bucket_results):
        print(line)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="count rows/files without writing")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (service-role, not publishable).")

    asyncio.run(run(args.dry_run))


if __name__ == "__main__":
    main()
