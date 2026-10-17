"""HillGPX community backend.

Replaces Supabase (reviews, photos, route photos, reports, community routes,
route thumbnails) and the built datasets (venues.json, routes.json, stats.json,
descriptions.json) with MongoDB + GridFS.

Static bulk data that changes only at build time — peak tiles, DEM bins and the
committed photo library — is served from a read-only directory mounted into the
container (STATIC_DIR, expected to hold `data/`, `photos/`, `route-thumbs/`).

Contribution rules mirror the old RLS policies: anyone can insert, reads of
photos and route photos return only approved rows, routes and reviews publish
immediately. Moderation endpoints require X-Admin-Token.
"""

import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from pydantic import BaseModel, Field

load_dotenv()

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.environ.get("MONGO_DB", "hillgpx")
STATIC_DIR = os.environ.get("STATIC_DIR", "/srv/public")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "60")) * 1024 * 1024

# Created inside the lifespan so Motor binds to uvicorn's running loop —
# a module-level client attaches to the import-time loop and every request
# fails with "attached to a different loop".
db: Any = None
fs: Any = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global db, fs
    client = AsyncIOMotorClient(MONGO_URI)
    db = client[MONGO_DB]
    fs = AsyncIOMotorGridFSBucket(db)
    yield
    client.close()


app = FastAPI(title="HillGPX API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def doc(row: dict[str, Any]) -> dict[str, Any]:
    row = dict(row)
    row.pop("_id", None)
    return row


def admin(x_admin_token: str = Header(default="")) -> None:
    if not ADMIN_TOKEN or x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Bad admin token")


# ─── Built datasets ─────────────────────────────────────────────────────────


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/data/{name}")
async def dataset(name: str) -> Any:
    if name not in {"venues.json", "routes.json", "stats.json", "descriptions.json"}:
        raise HTTPException(404)
    row = await db.datasets.find_one({"key": name})
    if not row:
        raise HTTPException(503, f"{name} not seeded — run seed.py")
    return row["payload"]


# ─── File storage (GridFS) ──────────────────────────────────────────────────

ALLOWED_BUCKETS = {"photos", "gpx", "route-thumbs"}


@app.post("/api/files/{bucket}/{path:path}", status_code=201)
async def upload_file(bucket: str, path: str, request: Request) -> dict[str, str]:
    if bucket not in ALLOWED_BUCKETS:
        raise HTTPException(400, "Unknown bucket")
    body = await request.body()
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large")
    if await fs.find({"metadata.bucket": bucket, "metadata.path": path}).to_list(1):
        raise HTTPException(409, "Duplicate file")
    await fs.upload_from_stream(
        path,
        body,
        metadata={
            "bucket": bucket,
            "path": path,
            "content_type": request.headers.get("content-type", "application/octet-stream"),
        },
    )
    return {"url": file_url(bucket, path)}


def file_url(bucket: str, path: str) -> str:
    return f"/api/files/{bucket}/{path}"


@app.get("/api/files/{bucket}/{path:path}")
async def get_file(bucket: str, path: str) -> Response:
    grid = await fs.find({"metadata.bucket": bucket, "metadata.path": path}).to_list(1)
    if not grid:
        raise HTTPException(404)
    f = grid[0]
    return Response(
        content=await f.read(),
        media_type=(f.metadata or {}).get("content_type", "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# ─── Reviews ────────────────────────────────────────────────────────────────


class ReviewIn(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    venue_slug: str
    rating: float
    comment: str = ""
    author: str | None = None


@app.get("/api/reviews")
async def list_reviews(venue_slug: str, limit: int = 200) -> list[dict[str, Any]]:
    cur = db.reviews.find({"venue_slug": venue_slug}).sort("created_at", -1).limit(min(limit, 500))
    return [doc(r) async for r in cur]


@app.post("/api/reviews", status_code=201)
async def create_review(review: ReviewIn) -> dict[str, Any]:
    row = review.model_dump()
    row["rating"] = max(1, min(5, row["rating"]))
    row["comment"] = row["comment"][:1000]
    row["author"] = (row["author"] or "")[:60] or None
    row["created_at"] = now()
    await db.reviews.insert_one(row)
    return doc(row)


# ─── Photos (moderated) ─────────────────────────────────────────────────────


class PhotoIn(BaseModel):
    id: str
    venue_slug: str
    storage_path: str
    credit: str | None = None
    licence: str = "CC BY-SA 4.0"
    author: str | None = None


@app.get("/api/photos")
async def list_photos(venue_slug: str, limit: int = 60) -> list[dict[str, Any]]:
    cur = (
        db.photos.find({"venue_slug": venue_slug, "status": "approved"})
        .sort("created_at", -1)
        .limit(min(limit, 200))
    )
    return [doc(r) async for r in cur]


@app.post("/api/photos", status_code=201)
async def create_photo(photo: PhotoIn) -> dict[str, Any]:
    row = photo.model_dump()
    row["credit"] = (row["credit"] or "")[:120] or None
    row["licence"] = row["licence"][:60]
    row["author"] = (row["author"] or "")[:60] or None
    row["status"] = "pending"
    row["created_at"] = now()
    await db.photos.insert_one(row)
    return doc(row)


# ─── Route photos / hazards (moderated) ─────────────────────────────────────


class RoutePhotoIn(BaseModel):
    id: str
    route_slug: str
    lng: float
    lat: float
    kind: str
    caption: str | None = None
    storage_path: str
    author: str | None = None


@app.get("/api/route_photos")
async def list_route_photos(route_slug: str, limit: int = 200) -> list[dict[str, Any]]:
    cur = (
        db.route_photos.find({"route_slug": route_slug, "status": "approved"})
        .sort("created_at", -1)
        .limit(min(limit, 500))
    )
    return [doc(r) async for r in cur]


@app.post("/api/route_photos", status_code=201)
async def create_route_photo(photo: RoutePhotoIn) -> dict[str, Any]:
    if photo.kind not in {"photo", "hazard"}:
        raise HTTPException(400, "kind must be photo or hazard")
    row = photo.model_dump()
    row["caption"] = (row["caption"] or "")[:280] or None
    row["author"] = (row["author"] or "")[:60] or None
    row["status"] = "pending"
    row["created_at"] = now()
    await db.route_photos.insert_one(row)
    return doc(row)


# ─── Community routes ───────────────────────────────────────────────────────


class RouteIn(BaseModel):
    slug: str
    name: str
    activity: str
    recorded_at: str | None = None
    distance_m: float
    gain_m: float
    loss_m: float
    elevation_source: str
    geom_hash: str
    west: float
    south: float
    east: float
    north: float
    venue_slugs: list[str] = []
    points: list[list[float]] = []
    gpx_path: str
    contributor: str | None = None
    licence: str = "CC0"


@app.get("/api/community/routes")
async def list_community_routes(limit: int = 1000) -> list[dict[str, Any]]:
    cur = db.routes.find().sort("created_at", -1).limit(min(limit, 5000))
    return [doc(r) async for r in cur]


@app.post("/api/community/routes", status_code=201)
async def create_community_route(route: RouteIn) -> dict[str, Any]:
    if await db.routes.find_one({"geom_hash": route.geom_hash}) or await db.routes.find_one(
        {"slug": route.slug}
    ):
        raise HTTPException(409, "This track is already in the community archive.")
    row = route.model_dump()
    row["name"] = row["name"][:120]
    row["venue_slugs"] = row["venue_slugs"][:200]
    row["points"] = row["points"][:5000]
    row["contributor"] = (row["contributor"] or "")[:60] or None
    row["created_at"] = now()
    await db.routes.insert_one(row)
    return doc(row)


@app.get("/api/community/stats")
async def community_stats() -> dict[str, Any]:
    routes = await db.routes.count_documents({})
    photos = await db.photos.count_documents({"status": "approved"})
    reviews = await db.reviews.count_documents({})
    route_venues = await db.routes.distinct("venue_slugs")
    photo_venues = await db.photos.distinct("venue_slug", {"status": "approved"})
    flat_route_venues = [v for sub in route_venues for v in (sub if isinstance(sub, list) else [sub])]
    return {
        "routes": routes,
        "photos": photos,
        "reviews": reviews,
        "routeVenues": sorted(set(flat_route_venues)),
        "photoVenues": sorted(set(photo_venues)),
    }


# ─── Reports ────────────────────────────────────────────────────────────────


class ReportIn(BaseModel):
    target_type: str
    target_slug: str
    kind: str
    message: str = ""
    author: str | None = None


@app.post("/api/reports", status_code=201)
async def create_report(report: ReportIn) -> dict[str, Any]:
    row = report.model_dump()
    row["message"] = row["message"][:1000]
    row["author"] = (row["author"] or "")[:60] or None
    row["status"] = "pending"
    row["created_at"] = now()
    await db.reports.insert_one(row)
    return doc(row)


# ─── Moderation (X-Admin-Token) ─────────────────────────────────────────────

MODERATED = {"photos", "route_photos", "reports"}


@app.get("/api/admin/{collection}", dependencies=[Depends(admin)])
async def admin_list(collection: str, status: str = "pending") -> list[dict[str, Any]]:
    if collection not in MODERATED:
        raise HTTPException(404)
    return [doc(r) async for r in db[collection].find({"status": status}).limit(500)]


@app.post("/api/admin/{collection}/{row_id}", dependencies=[Depends(admin)])
async def admin_set_status(collection: str, row_id: str, status: str) -> dict[str, str]:
    if collection not in MODERATED:
        raise HTTPException(404)
    if status not in {"approved", "rejected"}:
        raise HTTPException(400, "status must be approved or rejected")
    result = await db[collection].update_one({"id": row_id}, {"$set": {"status": status}})
    if not result.matched_count:
        raise HTTPException(404)
    return {"id": row_id, "status": status}


# ─── Static bulk data (peaks, DEM, photos, route thumbs) ────────────────────

for mount, sub in (("/data", "data"), ("/photos", "photos"), ("/route-thumbs", "route-thumbs")):
    directory = os.path.join(STATIC_DIR, sub)
    if os.path.isdir(directory):
        app.mount(mount, StaticFiles(directory=directory), name=sub)
