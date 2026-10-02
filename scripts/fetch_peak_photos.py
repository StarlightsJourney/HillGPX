#!/usr/bin/env python3
"""
Find an open-licence Wikimedia Commons photo for the summits the landing page
shows first: the tallest dozen in every country (from public/data/peaks/index.json).

Only links and credits are stored (public/data/peaks/photos.json); the images
stay on Wikimedia's servers, so the repo does not grow. A photo is picked when
it was taken within 2 km of the summit and is CC BY / CC BY-SA / CC0 / public
domain; maps, signs and diagrams are skipped, and files named after the peak
are preferred.

    python3 scripts/fetch_peak_photos.py            # resume; only peaks not yet searched
    python3 scripts/fetch_peak_photos.py --refresh  # search everything again

Standard library only; no key.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_peaks import ssl_context  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
INDEX = os.path.join(ROOT, "public", "data", "peaks", "index.json")
OUT = os.path.join(ROOT, "public", "data", "peaks", "photos.json")
UA = "HillGPX/0.4 (open source; https://github.com/StarlightsJourney/HillGPX)"
PER_COUNTRY = 12
OPEN = re.compile(r"^(cc[ -]by(-sa)?([ -]\d\.\d)?|cc0|public domain|pd)", re.I)
NOT_VIEW = re.compile(r"\b(map|sign|logo|diagram|plaque|chart|flag|coat of arms|locator|stamp|book)\b|\.(svg|pdf|tif|tiff|webm|ogv)$", re.I)
STOP = re.compile(r"\b(mount|mt|gunung|bukit|pico|monte|mont|berg|fjell|tind|shan|yama|dake|peak|hill)\b", re.I)


def token(n: int) -> str:
    return f"m{-n}" if n < 0 else str(n)


def slug_of(row: list, tile: int) -> str:
    lat, lng = row[2], row[3]
    south = int((lat // tile) * tile)
    west = int((lng // tile) * tile)
    return f"gn{row[0]}-{token(south)}x{token(west)}"


def core(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", STOP.sub(" ", name.lower())).strip()


def strip(text: str) -> str:
    return html.unescape(re.sub(r"<[^>]*>", "", text or "")).strip()


def search(row: list) -> list | None:
    params = urllib.parse.urlencode({
        "action": "query", "format": "json", "generator": "geosearch", "ggscoord": f"{row[2]}|{row[3]}",
        "ggsradius": 2000, "ggslimit": 15, "ggsnamespace": 6, "prop": "imageinfo",
        "iiprop": "url|extmetadata", "iiurlwidth": 640,
    })
    req = urllib.request.Request(f"https://commons.wikimedia.org/w/api.php?{params}", headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, context=ssl_context(), timeout=30) as resp:
                pages = (json.load(resp).get("query") or {}).get("pages") or {}
            break
        except Exception:
            time.sleep(2 * (attempt + 1))
    else:
        return None
    name = core(row[1])
    best = None
    for page in pages.values():
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata") or {}
        licence = strip(meta.get("LicenseShortName", {}).get("value", ""))
        title = page.get("title", "")
        if not info.get("thumburl") or not OPEN.match(licence) or NOT_VIEW.search(title):
            continue
        if (info.get("thumbwidth") or 0) < (info.get("thumbheight") or 1):
            continue  # portrait shots crop badly in square cards
        score = 2 if name and name in core(title) else 1
        if not best or score > best[0]:
            best = (score, [info["thumburl"], info.get("descriptionurl", ""), strip(meta.get("Artist", {}).get("value", "Unknown"))[:80], licence])
    return best[1] if best else wikipedia_image(row)


def wikipedia_image(row: list) -> list:
    """Fallback: the free lead image of a Wikipedia article about this summit (name must match, within 5 km)."""
    params = urllib.parse.urlencode({
        "action": "query", "format": "json", "generator": "geosearch", "ggscoord": f"{row[2]}|{row[3]}",
        "ggsradius": 5000, "ggslimit": 10, "prop": "pageimages|info", "piprop": "thumbnail",
        "pithumbsize": 640, "pilicense": "free", "inprop": "url",
    })
    req = urllib.request.Request(f"https://en.wikipedia.org/w/api.php?{params}", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, context=ssl_context(), timeout=30) as resp:
            pages = (json.load(resp).get("query") or {}).get("pages") or {}
    except Exception:
        return []
    name = core(row[1])
    for page in pages.values():
        thumb = page.get("thumbnail") or {}
        title = core(page.get("title", ""))
        if thumb.get("source") and name and len(name) >= 3 and (name in title or title in name) and thumb.get("width", 0) >= thumb.get("height", 1):
            return [thumb["source"], page.get("fullurl", ""), "Wikipedia", "Free licence (see page)"]
    return []


def main(refresh: bool, retry_missing: bool) -> None:
    with open(INDEX, encoding="utf-8") as fh:
        index = json.load(fh)
    tile = index["tile"]
    by_country: dict[str, list] = {}
    for row in index["top"]:
        by_country.setdefault(row[6], []).append(row)
    targets = [r for rows in by_country.values() for r in sorted(rows, key=lambda r: -r[4])[:PER_COUNTRY]]

    found: dict[str, list] = {}
    if os.path.exists(OUT) and not refresh:
        with open(OUT, encoding="utf-8") as fh:
            found = json.load(fh).get("photos", {})
    todo = [r for r in targets if slug_of(r, tile) not in found or (retry_missing and not found[slug_of(r, tile)])]
    print(f"{len(targets)} landing summits, {len(todo)} to search")

    def save() -> None:
        with open(OUT, "w", encoding="utf-8") as fh:
            json.dump({"note": "Wikimedia Commons photos near each summit; links only. Built by scripts/fetch_peak_photos.py.",
                       "photos": found}, fh, ensure_ascii=False, separators=(",", ":"))

    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        for i, (row, result) in enumerate(zip(todo, pool.map(search, todo)), 1):
            if result is not None:
                found[slug_of(row, tile)] = result
            if i % 100 == 0:
                save()
                print(f"  {i}/{len(todo)} searched, {sum(1 for v in found.values() if v)} with a photo")
    save()
    print(f"{sum(1 for v in found.values() if v)} of {len(found)} summits have a photo")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Commons photos for landing summits")
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--retry-missing", action="store_true", help="Search again for summits that had no photo")
    args = parser.parse_args()
    main(args.refresh, args.retry_missing)
