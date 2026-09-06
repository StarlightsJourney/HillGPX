#!/usr/bin/env python3
"""
Attach street-level photos to venues, from Mapillary.

    python scripts/fetch_photos.py --limit 500

Why Mapillary and not Google Street View: Street View imagery is Google's
copyright and their Terms of Service forbid scraping and redistribution, so it
cannot go into an open repository no matter how publicly viewable it is.
Mapillary is crowdsourced street-level imagery licensed CC-BY-SA, which can be
displayed and redistributed with attribution. It is the only free source of real
photos for arbitrary Singapore addresses that a public project can actually use.

This runs at BUILD time, not in the browser, and it DOWNLOADS each image rather
than recording a link to it. Mapillary serves thumbnails from a Facebook CDN
behind signed URLs carrying an `oe` expiry roughly a month out — committing those
links would leave every image on the site broken a month after launch, silently.
The files live in public/photos/ and are committed with everything else, so the
site is self-contained and the token is only needed to regenerate, the way the
OneMap one is. The Mapillary image id is recorded too, so any image can be traced
back to its source.

Get a free token at https://www.mapillary.com/dashboard/developers and put it in
.env.local as MAPILLARY_TOKEN.

Coverage is partial. Mapillary depends on people having driven or walked a
street with a camera, so many blocks will have no nearby image, and those keep
the drawn silhouette instead. That is the honest trade for imagery we are
allowed to use.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import io
import time
import urllib.parse
import urllib.request

import dotenv

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install -r scripts/requirements.txt")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.join(SCRIPT_DIR, "..")
dotenv.load_dotenv(os.path.join(REPO_ROOT, ".env.local"))

TOKEN = os.environ.get("MAPILLARY_TOKEN")
OUT_PATH = os.path.join(REPO_ROOT, "data", "photos.json")
PHOTO_DIR = os.path.join(REPO_ROOT, "public", "photos")

# Cards are ~210px wide and the detail image ~330px, so 640 covers both at 2x
# without turning the repository into an image host.
MAX_WIDTH = 640
JPEG_QUALITY = 78
GRAPH_URL = "https://graph.mapillary.com/images"

# How far from a venue an image may be and still be considered a photo of it.
# Much beyond this and you are looking at the next street over.
RADIUS_M = 60
REQUEST_DELAY_S = 0.12


def bbox_around(lng: float, lat: float, metres: float) -> str:
    """A degrees bounding box roughly `metres` across, centred on the point."""
    dlat = metres / 111_320
    dlng = metres / (111_320 * max(0.1, abs(__import__("math").cos(__import__("math").radians(lat)))))
    return f"{lng - dlng},{lat - dlat},{lng + dlng},{lat + dlat}"


def closest_image(lng: float, lat: float) -> dict | None:
    params = {
        "access_token": TOKEN,
        "fields": "id,thumb_1024_url,captured_at,compass_angle,creator",
        "bbox": bbox_around(lng, lat, RADIUS_M),
        "limit": 5,
    }
    url = f"{GRAPH_URL}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            data = json.load(resp).get("data", [])
    except Exception as exc:  # noqa: BLE001 — a miss is not fatal, just no photo
        print(f"    lookup failed: {exc}")
        return None

    if not data:
        return None

    # The API does not sort by distance, and any image in the box is close
    # enough at this radius; prefer the most recent one.
    best = max(data, key=lambda d: d.get("captured_at") or 0)
    return {
        "id": best["id"],
        "url": best.get("thumb_1024_url"),
        "creator": (best.get("creator") or {}).get("username"),
        "capturedAt": best.get("captured_at"),
    }


def download(url: str, slug: str) -> str | None:
    """Fetch, downscale and save one image. Returns its path relative to public/."""
    os.makedirs(PHOTO_DIR, exist_ok=True)
    dest = os.path.join(PHOTO_DIR, f"{slug}.jpg")
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "hillGPX/0.1"})
        with urllib.request.urlopen(request, timeout=30) as resp:
            raw = resp.read()
        image = Image.open(io.BytesIO(raw)).convert("RGB")
        if image.width > MAX_WIDTH:
            height = round(image.height * MAX_WIDTH / image.width)
            image = image.resize((MAX_WIDTH, height), Image.LANCZOS)
        image.save(dest, "JPEG", quality=JPEG_QUALITY, optimize=True)
        return f"photos/{slug}.jpg"
    except Exception as exc:  # noqa: BLE001 — a failed download is just no photo
        print(f"    download failed for {slug}: {exc}")
        return None


def main(limit: int | None, only_missing: bool) -> None:
    if not TOKEN:
        sys.exit(
            "MAPILLARY_TOKEN is not set.\n"
            "Get a free token at https://www.mapillary.com/dashboard/developers\n"
            "then add it to .env.local as MAPILLARY_TOKEN=..."
        )

    venues_path = os.path.join(REPO_ROOT, "public", "data", "venues.json")
    if not os.path.exists(venues_path):
        sys.exit("public/data/venues.json missing — run scripts/build_data.py first")

    with open(venues_path, encoding="utf-8") as fh:
        venues = json.load(fh)["venues"]

    photos: dict[str, dict] = {}
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, encoding="utf-8") as fh:
            photos = json.load(fh).get("photos", {})
        print(f"  {len(photos):,} venues already have a photo record")

    # Tallest first: if this is interrupted, the venues people actually look at
    # are the ones that got covered.
    targets = sorted(venues, key=lambda v: -(v.get("gainM") or 0))
    if only_missing:
        targets = [v for v in targets if v["slug"] not in photos]
    if limit:
        targets = targets[:limit]

    print(f"  Looking up {len(targets):,} venues (radius {RADIUS_M} m)")

    found = 0
    for i, venue in enumerate(targets, 1):
        image = closest_image(venue["lng"], venue["lat"])
        record: dict = {}
        if image and image.get("url"):
            saved = download(image["url"], venue["slug"])
            if saved:
                record = {
                    "id": image["id"],
                    "file": saved,
                    "creator": image.get("creator"),
                    "capturedAt": image.get("capturedAt"),
                }
        # Record misses too, so a re-run does not pay for them again.
        photos[venue["slug"]] = record
        if record:
            found += 1
        if i % 25 == 0 or i == len(targets):
            print(f"    {i:,}/{len(targets):,}  ({found:,} with imagery)")
            _save(photos)
        time.sleep(REQUEST_DELAY_S)

    _save(photos)
    covered = sum(1 for v in photos.values() if v)
    print(
        f"\nWrote {os.path.relpath(OUT_PATH, REPO_ROOT)}: "
        f"{covered:,} of {len(photos):,} venues have imagery"
    )
    print("Next: python scripts/build_data.py")


def _save(photos: dict[str, dict]) -> None:
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    payload = {
        "source": "Mapillary",
        "licence": "CC-BY-SA 4.0 — imagery © its contributors, via Mapillary",
        "note": "Files live in public/photos/. Mapillary's own URLs are signed and "
                "expire about a month out, so they are not stored.",
        "photos": photos,
    }
    tmp = OUT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    os.replace(tmp, OUT_PATH)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Attach Mapillary photos to venues")
    parser.add_argument("--limit", type=int, default=None, help="Only process the N tallest venues")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Re-check venues that already have a record, instead of only missing ones",
    )
    args = parser.parse_args()
    main(limit=args.limit, only_missing=not args.all)
