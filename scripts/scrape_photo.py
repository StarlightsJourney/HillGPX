#!/usr/bin/env python3
"""
Import a venue photo from an image URL.

    python3 scripts/scrape_photo.py URL --venue VENUE_SLUG [--credit "Name"] [--licence "CC BY-SA 4.0"]

The image is downloaded, downscaled to the same size the site uses, saved to
public/photos/<slug>.webp, and registered in data/photos.json. Run
scripts/build_data.py afterwards to attach it to the venue.

Only import photos you have permission to republish. The script checks the
content-type and refuses non-image responses, but it cannot check copyright for
you.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import urllib.request

from fetch_photos import PHOTO_DIR, OUT_PATH, REPO_ROOT, MAX_WIDTH, WEBP_QUALITY

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install -r scripts/requirements.txt")


def load_photos() -> dict:
    if not os.path.exists(OUT_PATH):
        return {}
    with open(OUT_PATH, encoding="utf-8") as fh:
        return json.load(fh).get("photos", {})


def save_photos(photos: dict) -> None:
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump({"photos": photos}, fh, indent=2, ensure_ascii=False)


def download_image(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "hillGPX/0.1"})
    with urllib.request.urlopen(request, timeout=30) as resp:
        content_type = resp.headers.get("Content-Type", "")
        if not content_type.startswith("image/"):
            raise ValueError(f"URL returned {content_type}, not an image")
        return resp.read()


def process_image(data: bytes, slug: str) -> str:
    os.makedirs(PHOTO_DIR, exist_ok=True)
    dest = os.path.join(PHOTO_DIR, f"{slug}.webp")
    image = Image.open(io.BytesIO(data)).convert("RGB")
    if image.width > MAX_WIDTH:
        height = round(image.height * MAX_WIDTH / image.width)
        image = image.resize((MAX_WIDTH, height), Image.Resampling.LANCZOS)
    image.save(dest, "WEBP", quality=WEBP_QUALITY, method=6)
    return os.path.relpath(dest, REPO_ROOT)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a venue photo from a URL")
    parser.add_argument("url", help="Direct image URL")
    parser.add_argument("--venue", required=True, help="Venue slug to attach the photo to")
    parser.add_argument("--credit", default="", help="Photographer or source credit")
    parser.add_argument("--licence", default="", help="Licence or usage terms")
    args = parser.parse_args()

    photos = load_photos()
    if args.venue in photos:
        print(f"Warning: overwriting existing photo for {args.venue}")

    data = download_image(args.url)
    relpath = process_image(data, args.venue)
    photos[args.venue] = {
        "file": relpath,
        "creator": args.credit or None,
        "licence": args.licence or None,
    }
    save_photos(photos)
    print(f"Saved {relpath}")
    print("Next: python3 scripts/build_data.py")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
