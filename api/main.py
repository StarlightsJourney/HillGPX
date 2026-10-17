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

import hashlib
import hmac
import os
import re
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from pydantic import BaseModel, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

load_dotenv()

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.environ.get("MONGO_DB", "hillgpx")
STATIC_DIR = os.environ.get("STATIC_DIR", "/srv/public")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "60")) * 1024 * 1024

# Accounts: Google OAuth client ID (the audience ID tokens must carry) and the
# bearer-session lifetime. Passwords are PBKDF2-SHA256 — no extra dependency.
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "30"))
PBKDF2_ITERATIONS = 210_000
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,24}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

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
    # Unique logins; sessions expire on their `expires_at` date.
    await db.users.create_index("email", unique=True)
    await db.users.create_index("username_lower", unique=True)
    await db.sessions.create_index("token_hash", unique=True)
    await db.sessions.create_index("expires_at", expireAfterSeconds=0)
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


# Session lookup lives here (before the endpoints): contribution inserts use
# maybe_user to stamp uploads with the uploader's id when signed in.


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def lookup_session_user(token: str) -> dict[str, Any] | None:
    session = await db.sessions.find_one({"token_hash": token_hash(token)})
    if not session:
        return None
    expires = session["expires_at"]
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        return None
    user = await db.users.find_one({"id": session["user_id"]})
    if not user:
        return None
    user["_session_hash"] = session["token_hash"]
    return user


async def maybe_user(authorization: str = Header(default="")) -> dict[str, Any] | None:
    """Like current_user but quiet: anonymous contributions keep working."""
    if not authorization.startswith("Bearer "):
        return None
    return await lookup_session_user(authorization[7:])


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
    # Avatars are readable by everyone (they show on profiles) but writable
    # only through /api/auth/me/avatar — they are not in ALLOWED_BUCKETS.
    if bucket not in ALLOWED_BUCKETS and bucket != "avatars":
        raise HTTPException(404)
    row = await db["fs.files"].find_one({"metadata.bucket": bucket, "metadata.path": path})
    if not row:
        raise HTTPException(404)
    if bucket == "gpx":
        # Every fetch of a community route's file counts one download.
        await db.routes.update_one({"gpx_path": path}, {"$inc": {"downloads": 1}})
    grid_out = await fs.open_download_stream(row["_id"])
    return Response(
        content=await grid_out.read(),
        media_type=(row.get("metadata") or {}).get("content_type", "application/octet-stream"),
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
    # Signed-in uploaders may opt out of attribution: no user_id, no name.
    anonymous: bool = False
    # Only "public" exists so far; the field is the seam for a future private tier.
    visibility: str = "public"


@app.get("/api/community/routes")
async def list_community_routes(limit: int = 1000) -> list[dict[str, Any]]:
    # Rows without a visibility flag predate the field — they are all public.
    cur = db.routes.find({"visibility": {"$ne": "private"}}).sort("created_at", -1).limit(min(limit, 5000))
    return [doc(r) async for r in cur]


@app.post("/api/community/routes", status_code=201)
async def create_community_route(route: RouteIn, user: dict[str, Any] | None = Depends(maybe_user)) -> dict[str, Any]:
    if await db.routes.find_one({"geom_hash": route.geom_hash}) or await db.routes.find_one(
        {"slug": route.slug}
    ):
        raise HTTPException(409, "This track is already in the community archive.")
    row = route.model_dump()
    # Signed-in uploaders get their id stamped so "My uploads" can list them;
    # the anonymous flag withholds both the stamp and the public credit.
    row["user_id"] = None if row["anonymous"] or not user else user["id"]
    row["name"] = row["name"][:120]
    row["venue_slugs"] = row["venue_slugs"][:200]
    row["points"] = row["points"][:5000]
    row["contributor"] = None if row["anonymous"] else ((row["contributor"] or "")[:60] or None)
    row["visibility"] = "public"
    row["downloads"] = 0
    row["created_at"] = now()
    await db.routes.insert_one(row)
    return doc(row)


# ─── Download counts (all routes) ──────────────────────────────────────────
#
# The browser builds the GPX client-side, so downloads never touch a file
# URL — every route counts here instead. Community slugs keep the counter on
# their row; everything else lives in `route_downloads`.


@app.post("/api/routes/{slug}/download")
async def count_route_download(slug: str) -> dict[str, Any]:
    slug = slug[:120]
    hit = await db.routes.update_one({"slug": slug}, {"$inc": {"downloads": 1}})
    if hit.matched_count:
        row = await db.routes.find_one({"slug": slug}, {"downloads": 1})
        return {"slug": slug, "downloads": row["downloads"]}
    r = await db.route_downloads.find_one_and_update(
        {"slug": slug},
        {"$inc": {"count": 1}, "$setOnInsert": {"slug": slug}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return {"slug": slug, "downloads": r["count"]}


@app.get("/api/routes/downloads")
async def route_downloads() -> dict[str, int]:
    out: dict[str, int] = {}
    async for r in db.route_downloads.find():
        out[r["slug"]] = r["count"]
    async for r in db.routes.find({"downloads": {"$gt": 0}}, {"slug": 1, "downloads": 1}):
        out[r["slug"]] = r["downloads"]
    return out


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


# ─── Accounts ───────────────────────────────────────────────────────────────
#
# Email+password sign-up with a public username, or Google sign-in (the
# frontend sends the ID token from Google Identity Services; the API checks it
# against tokeninfo and the configured audience). Both end the same way: an
# opaque bearer token stored as a SHA-256 hash in `sessions`, returned to the
# browser which keeps it in localStorage (`hillgpx:session`). Sessions are not
# JWTs — they are revocable rows that expire after SESSION_TTL_DAYS.

PBKDF2_ALGO = "sha256"


class SignupIn(BaseModel):
    username: str
    email: str
    password: str


class LoginIn(BaseModel):
    identifier: str  # email or username
    password: str


class GoogleIn(BaseModel):
    credential: str  # ID token from Google Identity Services


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(PBKDF2_ALGO, password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac(PBKDF2_ALGO, password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, AttributeError):
        return False


async def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    await db.sessions.insert_one(
        {
            "token_hash": token_hash(token),
            "user_id": user_id,
            "created_at": now(),
            # A real datetime so the TTL index can collect it.
            "expires_at": datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS),
        }
    )
    return token


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "providers": user.get("providers", ["password"]),
        "avatarUrl": file_url("avatars", user["avatar_path"]) if user.get("avatar_path") else None,
        "createdAt": user["created_at"],
    }


async def current_user(authorization: str = Header(default="")) -> dict[str, Any]:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sign in first.")
    user = await lookup_session_user(authorization[7:])
    if not user:
        raise HTTPException(401, "Session expired — sign in again.")
    return user


# Cheap guard for the credential endpoints: 30 tries per IP per 5 minutes.
_auth_hits: dict[str, list[float]] = {}


def auth_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    cutoff = time.time() - 300
    hits = [t for t in _auth_hits.get(ip, []) if t > cutoff]
    if len(hits) >= 30:
        raise HTTPException(429, "Too many attempts — wait a few minutes and try again.")
    hits.append(time.time())
    _auth_hits[ip] = hits


async def unique_username(seed: str) -> str:
    base = re.sub(r"[^a-z0-9_.-]+", "-", seed.lower()).strip("-._")[:20] or "climber"
    if len(base) < 3:
        base += "-" * (3 - len(base))
    for suffix in ["", *(f"-{i}" for i in range(2, 100))]:
        candidate = f"{base}{suffix}"
        if not await db.users.find_one({"username_lower": candidate.lower()}):
            return candidate
    return f"{base[:16]}-{secrets.token_hex(3)}"


async def insert_user(username: str, email: str, password: str | None, providers: list[str]) -> dict[str, Any]:
    row = {
        "id": uuid.uuid4().hex,
        "username": username,
        "username_lower": username.lower(),
        "email": email,
        "password_hash": hash_password(password) if password else None,
        "providers": providers,
        "created_at": now(),
    }
    await db.users.insert_one(row)
    return row


@app.post("/api/auth/signup", status_code=201, dependencies=[Depends(auth_rate_limit)])
async def signup(body: SignupIn) -> dict[str, Any]:
    username = body.username.strip()
    email = body.email.strip().lower()
    if not USERNAME_RE.match(username):
        raise HTTPException(400, "Usernames are 3–24 letters, numbers, dots, dashes or underscores.")
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "That email does not look right.")
    if not 8 <= len(body.password) <= 128:
        raise HTTPException(400, "Passwords need at least 8 characters.")
    if await db.users.find_one({"username_lower": username.lower()}):
        raise HTTPException(409, "That username is taken.")
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "That email is already registered — try logging in.")
    try:
        user = await insert_user(username, email, body.password, ["password"])
    except DuplicateKeyError:
        raise HTTPException(409, "That username or email is taken.") from None
    return {"token": await create_session(user["id"]), "user": public_user(user)}


@app.post("/api/auth/login", dependencies=[Depends(auth_rate_limit)])
async def login(body: LoginIn) -> dict[str, Any]:
    ident = body.identifier.strip().lower()
    user = await db.users.find_one({"$or": [{"email": ident}, {"username_lower": ident}]})
    if not user or not user.get("password_hash") or not check_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Wrong email or password.")
    return {"token": await create_session(user["id"]), "user": public_user(user)}


@app.post("/api/auth/google", dependencies=[Depends(auth_rate_limit)])
async def google_login(body: GoogleIn) -> dict[str, Any]:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Google sign-in is not configured on this server.")
    async with httpx.AsyncClient(timeout=10) as client:
        check = await client.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": body.credential})
    if check.status_code != 200:
        raise HTTPException(401, "Google did not recognise that sign-in. Try again.")
    claims = check.json()
    if claims.get("aud") != GOOGLE_CLIENT_ID:
        raise HTTPException(401, "That Google sign-in is for a different app.")
    if claims.get("email_verified") not in (True, "true") or not claims.get("email"):
        raise HTTPException(400, "That Google account has no verified email.")
    email = str(claims["email"]).lower()
    user = await db.users.find_one({"email": email})
    if user:
        if "google" not in user.get("providers", []):
            await db.users.update_one({"id": user["id"]}, {"$addToSet": {"providers": "google"}})
    else:
        # Username comes from the email's local part, made unique. Google's
        # "name" is a display name, not a handle, so it is only a fallback.
        seed = email.split("@", 1)[0] or str(claims.get("name") or "climber")
        for _ in range(5):
            try:
                user = await insert_user(await unique_username(seed), email, None, ["google"])
                break
            except DuplicateKeyError:
                continue
        else:
            raise HTTPException(409, "Could not pick a username — try signing up with email instead.")
    return {"token": await create_session(user["id"]), "user": public_user(user)}


@app.get("/api/auth/me")
async def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"user": public_user(user)}


class ProfileIn(BaseModel):
    username: str | None = None
    email: str | None = None


@app.patch("/api/auth/me")
async def update_profile(body: ProfileIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    updates: dict[str, Any] = {}
    if body.username is not None:
        username = body.username.strip()
        if not USERNAME_RE.match(username):
            raise HTTPException(400, "Usernames are 3–24 letters, numbers, dots, dashes or underscores.")
        clash = await db.users.find_one({"username_lower": username.lower()})
        if clash and clash["id"] != user["id"]:
            raise HTTPException(409, "That username is taken.")
        updates.update({"username": username, "username_lower": username.lower()})
    if body.email is not None:
        email = body.email.strip().lower()
        if not EMAIL_RE.match(email):
            raise HTTPException(400, "That email does not look right.")
        clash = await db.users.find_one({"email": email})
        if clash and clash["id"] != user["id"]:
            raise HTTPException(409, "That email is already registered.")
        updates["email"] = email
    if not updates:
        raise HTTPException(400, "Nothing to change.")
    try:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    except DuplicateKeyError:
        raise HTTPException(409, "That username or email is taken.") from None
    return {"user": public_user({**user, **updates})}


class PasswordIn(BaseModel):
    current_password: str
    new_password: str


@app.post("/api/auth/me/password", dependencies=[Depends(auth_rate_limit)])
async def change_password(body: PasswordIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, str]:
    if not user.get("password_hash"):
        raise HTTPException(400, "This account uses Google sign-in — there is no password to change.")
    if not check_password(body.current_password, user["password_hash"]):
        raise HTTPException(401, "That is not your current password.")
    if not 8 <= len(body.new_password) <= 128:
        raise HTTPException(400, "Passwords need at least 8 characters.")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_password(body.new_password)}})
    # Sign out everywhere else; the session making this call stays valid.
    await db.sessions.delete_many({"user_id": user["id"], "token_hash": {"$ne": user["_session_hash"]}})
    return {"status": "ok"}


# ─── Profile photo ──────────────────────────────────────────────────────────

AVATAR_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_AVATAR_BYTES = 8 * 1024 * 1024


async def delete_avatar(user: dict[str, Any]) -> None:
    path = user.get("avatar_path")
    if not path:
        return
    old = await db["fs.files"].find_one({"metadata.bucket": "avatars", "metadata.path": path})
    if old:
        await fs.delete(old["_id"])


@app.post("/api/auth/me/avatar")
async def upload_avatar(request: Request, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    content_type = request.headers.get("content-type", "")
    if content_type not in AVATAR_TYPES:
        raise HTTPException(400, "Send a JPEG, PNG or WebP image.")
    body = await request.body()
    if not body or len(body) > MAX_AVATAR_BYTES:
        raise HTTPException(413, "Image too large — keep it under 8 MB.")
    await delete_avatar(user)
    path = f"{user['id']}/{uuid.uuid4().hex}.{AVATAR_TYPES[content_type]}"
    await fs.upload_from_stream(
        path,
        body,
        metadata={"bucket": "avatars", "path": path, "content_type": content_type},
    )
    await db.users.update_one({"id": user["id"]}, {"$set": {"avatar_path": path}})
    return {"user": public_user({**user, "avatar_path": path})}


@app.delete("/api/auth/me/avatar")
async def remove_avatar(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    await delete_avatar(user)
    await db.users.update_one({"id": user["id"]}, {"$unset": {"avatar_path": ""}})
    user.pop("avatar_path", None)
    return {"user": public_user(user)}


class DeleteIn(BaseModel):
    password: str | None = None


@app.delete("/api/auth/me", status_code=204)
async def delete_account(body: DeleteIn, user: dict[str, Any] = Depends(current_user)) -> Response:
    # Password accounts confirm with their password; Google-only accounts have
    # nothing to check against and delete straight away.
    if user.get("password_hash") and not check_password(body.password or "", user["password_hash"]):
        raise HTTPException(401, "Enter your password to delete the account.")
    await delete_avatar(user)
    await db.sessions.delete_many({"user_id": user["id"]})
    await db.users.delete_one({"id": user["id"]})
    return Response(status_code=204)


@app.get("/api/auth/me/routes")
async def my_routes(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    cur = db.routes.find({"user_id": user["id"]}).sort("created_at", -1).limit(500)
    return [doc(r) async for r in cur]


async def delete_file(bucket: str, path: str) -> None:
    if not path:
        return
    f = await db["fs.files"].find_one({"metadata.bucket": bucket, "metadata.path": path})
    if f:
        await fs.delete(f["_id"])


@app.delete("/api/auth/me/routes/{slug}", status_code=204)
async def delete_my_route(slug: str, user: dict[str, Any] = Depends(current_user)) -> Response:
    route = await db.routes.find_one({"slug": slug, "user_id": user["id"]})
    if not route:
        raise HTTPException(404, "No such route on your account.")
    await db.routes.delete_one({"slug": slug})
    # The route, its stored GPX, rendered card thumbnails, its download
    # counter and pinned route photos all go together.
    await delete_file("gpx", route.get("gpx_path", ""))
    async for f in db["fs.files"].find(
        {"metadata.bucket": "route-thumbs", "metadata.path": {"$regex": f"^{re.escape(slug)}-"}}
    ):
        await fs.delete(f["_id"])
    await db.route_downloads.delete_one({"slug": slug})
    await db.route_photos.delete_many({"route_slug": slug})
    return Response(status_code=204)


@app.post("/api/auth/logout", status_code=204)
async def logout(authorization: str = Header(default="")) -> Response:
    if authorization.startswith("Bearer "):
        await db.sessions.delete_one({"token_hash": token_hash(authorization[7:])})
    return Response(status_code=204)


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
