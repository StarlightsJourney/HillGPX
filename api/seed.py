"""Load the built datasets (public/data/*.json) into MongoDB.

Run inside the api container after `docker compose up`:

    docker compose exec api python seed.py

or locally:  MONGO_URI=mongodb://localhost:27017 python seed.py [static_dir]
"""

import asyncio
import json
import os
import sys

from motor.motor_asyncio import AsyncIOMotorClient

DATASETS = ("venues.json", "routes.json", "stats.json", "descriptions.json")


async def main(static_dir: str) -> None:
    client = AsyncIOMotorClient(os.environ.get("MONGO_URI", "mongodb://localhost:27017"))
    db = client[os.environ.get("MONGO_DB", "hillgpx")]
    for name in DATASETS:
        path = os.path.join(static_dir, name)
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        await db.datasets.replace_one({"key": name}, {"key": name, "payload": payload}, upsert=True)
        print(f"seeded {name}")
    for coll, keys in (
        ("reviews", [("venue_slug", 1)]),
        ("photos", [("venue_slug", 1), ("status", 1)]),
        ("route_photos", [("route_slug", 1), ("status", 1)]),
        ("routes", [("geom_hash", 1), ("slug", 1)]),
        ("reports", [("status", 1)]),
    ):
        await db[coll].create_index(keys)
    print("indexes ready")


if __name__ == "__main__":
    default_dir = os.environ.get("SEED_DIR", "/srv/public/data")
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else default_dir))
