#!/usr/bin/env python3
"""
Import named summits with recorded elevations from OpenStreetMap.

    python scripts/fetch_peaks.py --region sg-my
    python scripts/fetch_peaks.py --bbox 5.5,116.0,7.0,117.5 --min-ele 1000

This is what makes the map work outside Singapore. OSM tags summits as
`natural=peak` (and `natural=volcano`) with an `ele` tag in metres, worldwide,
under ODbL — so there is no need to curate hills by hand per country. Overpass
serves it with no account and no API key.

Only summits with a recorded elevation and a name are imported. An unnamed bump
with no height is not a training venue, and a venue whose height we would have to
guess is worse than no venue at all.

NOTE ON WHAT THE HEIGHT MEANS: `ele` is metres above sea level — the summit, not
the climb. It is stored as summitM and the app labels it as elevation. The climb
from a trailhead is a different number that OSM does not record; it stays null
until somebody measures it.

Output: data/venues/peaks.json, merged by scripts/build_data.py.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.join(SCRIPT_DIR, "..")
OUT_PATH = os.path.join(REPO_ROOT, "data", "venues", "peaks.json")

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# south, west, north, east — Overpass's order.
REGIONS: dict[str, tuple[float, float, float, float]] = {
    "singapore": (1.15, 103.55, 1.50, 104.15),
    "sg-my": (0.8, 99.5, 7.5, 105.0),      # Singapore + peninsular Malaysia
    "sea": (-11.0, 92.0, 21.0, 127.0),      # Southeast Asia
    "alps": (43.5, 5.0, 48.0, 16.5),
    "japan": (30.0, 129.0, 46.0, 146.0),
    "nz": (-47.5, 166.0, -34.0, 179.0),
}


def build_query(bbox: tuple[float, float, float, float], min_ele: float) -> str:
    s, w, n, e = bbox
    # `ele` is free text in OSM ("1,234", "500 m", "2000ft"), so filtering by
    # value in Overpass is unreliable — fetch everything tagged with one and a
    # name, then parse and filter here.
    return f"""
[out:json][timeout:180];
(
  node["natural"="peak"]["ele"]["name"]({s},{w},{n},{e});
  node["natural"="volcano"]["ele"]["name"]({s},{w},{n},{e});
);
out body;
""".strip()


def parse_ele(raw: str) -> float | None:
    """OSM `ele` is free text. Accept metres; reject feet and anything odd."""
    if not raw:
        return None
    text = raw.strip().lower().replace(",", "")
    if "ft" in text or "'" in text:
        return None  # not converting: a mis-parsed unit is worse than a gap
    match = re.match(r"^(-?\d+(?:\.\d+)?)", text)
    if not match:
        return None
    try:
        value = float(match.group(1))
    except ValueError:
        return None
    # Nothing on land is below -450 m or above Everest.
    return value if -450 <= value <= 8850 else None


def slugify(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")


def fetch(query: str) -> list[dict]:
    data = urllib.parse.urlencode({"data": query}).encode()
    request = urllib.request.Request(
        OVERPASS_URL,
        data=data,
        headers={"User-Agent": "hillGPX/0.1 (open source; github.com/StarlightsJourney/HillGPX)"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=200) as resp:
                return json.load(resp).get("elements", [])
        except urllib.error.HTTPError as exc:
            # Overpass returns 429 and 504 under load; both are worth retrying.
            if exc.code in (429, 504) and attempt < 2:
                wait = 20 * (attempt + 1)
                print(f"  Overpass busy ({exc.code}); retrying in {wait}s")
                time.sleep(wait)
                continue
            raise
    return []


def main(bbox: tuple[float, float, float, float], min_ele: float, merge: bool) -> None:
    print(f"Querying Overpass for named summits in {bbox} with ele >= {min_ele:g} m")
    elements = fetch(build_query(bbox, min_ele))
    print(f"  {len(elements):,} tagged summits returned")

    existing: dict[str, dict] = {}
    if merge and os.path.exists(OUT_PATH):
        with open(OUT_PATH, encoding="utf-8") as fh:
            existing = {v["slug"]: v for v in json.load(fh).get("venues", [])}
        print(f"  {len(existing):,} already in {os.path.basename(OUT_PATH)}")

    kept = 0
    skipped_ele = 0
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name")
        ele = parse_ele(tags.get("ele", ""))
        if not name:
            continue
        if ele is None or ele < min_ele:
            skipped_ele += 1
            continue

        slug = slugify(f"{name}-{el['id']}")
        existing[slug] = {
            "slug": slug,
            "name": name,
            "type": "hill",
            "lat": round(el["lat"], 5),
            "lng": round(el["lon"], 5),
            # `ele` is height above sea level, not the climb. Keeping gainM null
            # is what stops the app claiming a 2,000 m mountain is a 2,000 m climb.
            "summitM": round(ele),
            "gainM": None,
            "elevationSource": "community",
            "osmId": el["id"],
            "notes": (
                f"Summit elevation from OpenStreetMap"
                + (f" · {tags['natural']}" if tags.get("natural") else "")
            ),
        }
        kept += 1

    venues = sorted(existing.values(), key=lambda v: -(v.get("summitM") or 0))
    payload = {
        "_readme": [
            "Generated by scripts/fetch_peaks.py from OpenStreetMap via Overpass.",
            "Do not hand-edit: re-running the script overwrites this file.",
            "summitM is metres above sea level. gainM (the actual climb from a",
            "trailhead) is null because OSM does not record it.",
            "Data (c) OpenStreetMap contributors, ODbL.",
        ],
        "venues": venues,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=False)

    print(f"  {kept:,} imported this run, {skipped_ele:,} skipped for missing or unusable ele")
    print(f"\nWrote {os.path.relpath(OUT_PATH, REPO_ROOT)} with {len(venues):,} summits")
    if venues:
        print("  Tallest:")
        for v in venues[:5]:
            print(f"    {v['summitM']:>5} m  {v['name']}")
    print("\nNext: python scripts/build_data.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import OSM summits with elevations")
    parser.add_argument("--region", choices=sorted(REGIONS), help="A named preset bounding box")
    parser.add_argument("--bbox", help="south,west,north,east in degrees")
    parser.add_argument(
        "--min-ele",
        type=float,
        default=50.0,
        help="Ignore summits below this height in metres (default 50)",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Discard existing peaks instead of merging this region into them",
    )
    args = parser.parse_args()

    if args.bbox:
        parts = [float(x) for x in args.bbox.split(",")]
        if len(parts) != 4:
            sys.exit("--bbox needs four numbers: south,west,north,east")
        box = (parts[0], parts[1], parts[2], parts[3])
    elif args.region:
        box = REGIONS[args.region]
    else:
        sys.exit(f"Pass --region ({', '.join(sorted(REGIONS))}) or --bbox south,west,north,east")

    main(box, args.min_ele, merge=not args.replace)
