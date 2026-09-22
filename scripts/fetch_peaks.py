#!/usr/bin/env python3
"""
Import named summits with recorded elevations from OpenStreetMap.

    python3 scripts/fetch_peaks.py --region sg-my
    python3 scripts/fetch_peaks.py --region hk,tw
    python3 scripts/fetch_peaks.py --bbox 5.5,116.0,7.0,117.5 --min-ele 1000

This is what makes the map work outside Singapore. OSM tags summits as
`natural=peak` (and `natural=volcano`) with an `ele` tag in metres, worldwide,
under ODbL — so there is no need to curate hills by hand per country. Overpass
serves it with no account and no API key.

Only summits with a recorded elevation and a name are imported. An unnamed bump
with no height is not a training venue, and a venue whose height we would have to
guess is worse than no venue at all.

Several regions can be passed at once, comma-separated. Each is queried in turn
(with a pause between requests, to be polite to the public Overpass servers) and
merged into the existing file by slug, which embeds the OSM node id — so
re-running a region refreshes its entries without duplicating them, and other
regions already in the file are kept. `--replace` starts from an empty file.

Every region has its own default minimum elevation (see REGIONS) so that dense
mountain countries do not swamp the dataset: Japan alone has tens of thousands
of named, surveyed summits. `--min-ele` overrides the default for every region
in the run, and `--max-per-region` keeps only the tallest N of each region.

NOTE ON WHAT THE HEIGHT MEANS: `ele` is metres above sea level — the summit, not
the climb. It is stored as summitM and the app labels it as elevation. The climb
from a trailhead is a different number that OSM does not record; it stays null
until somebody measures it.

Output: data/venues/peaks.json, merged by scripts/build_data.py.
Standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.join(SCRIPT_DIR, "..")
OUT_PATH = os.path.join(REPO_ROOT, "data", "venues", "peaks.json")

# Tried in order; the second is a community mirror used only if the main
# instance is unreachable or keeps refusing.
OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
USER_AGENT = "HillGPX/0.2 (open source; https://github.com/StarlightsJourney/HillGPX)"

# Seconds between consecutive region requests.
POLITE_PAUSE_S = 10
REQUEST_TIMEOUT_S = 200

# Keep the committed file (and the venues.json the browser parses) small.
SIZE_WARN_BYTES = 2 * 1024 * 1024

# id -> (bbox as south, west, north, east — Overpass's order; default min ele m)
REGIONS: dict[str, tuple[tuple[float, float, float, float], float]] = {
    "singapore": ((1.15, 103.55, 1.50, 104.15), 50),
    "sg-my": ((0.8, 99.5, 7.5, 105.0), 100),         # Singapore + peninsular Malaysia
    "id": ((-9.0, 95.0, 6.0, 116.0), 1500),          # Sumatra, Java, Bali, Lombok
    "th": ((5.6, 97.3, 20.5, 105.7), 1000),
    "vn": ((8.4, 102.1, 23.4, 109.5), 1500),
    "ph": ((4.5, 116.9, 21.2, 126.7), 1200),
    "tw": ((21.85, 119.3, 25.35, 122.1), 2500),     # Taiwan is steep and heavily surveyed
    "hk": ((22.13, 113.82, 22.57, 114.45), 150),
    "jp": ((24.0, 122.9, 45.6, 146.0), 2000),
    "kr": ((33.1, 124.6, 38.65, 131.9), 800),
    "au": ((-43.7, 112.9, -10.0, 153.7), 1200),
    "nz": ((-47.5, 166.0, -34.0, 179.0), 1800),
    # Older aliases and broad presets kept for compatibility.
    "japan": ((30.0, 129.0, 46.0, 146.0), 2000),
    "sea": ((-11.0, 92.0, 21.0, 127.0), 1500),       # Southeast Asia
    "alps": ((43.5, 5.0, 48.0, 16.5), 2500),
}


def build_query(bbox: tuple[float, float, float, float]) -> str:
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


def ssl_context() -> ssl.SSLContext:
    """
    A verifying TLS context that also works on python.org macOS builds.

    Those builds ship without a CA bundle until "Install Certificates.command"
    is run, so every HTTPS call fails with CERTIFICATE_VERIFY_FAILED. Rather
    than disabling verification, fall back to certifi if it happens to be
    installed, then to the system bundle macOS and most Linuxes provide.
    """
    ctx = ssl.create_default_context()
    if ctx.get_ca_certs() or os.environ.get("SSL_CERT_FILE"):
        return ctx
    try:
        import certifi  # type: ignore[import-not-found]

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    for path in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"):
        if os.path.exists(path):
            return ssl.create_default_context(cafile=path)
    return ctx


def fetch(query: str) -> list[dict]:
    """POST a query to Overpass with retries, backoff and a mirror fallback."""
    data = urllib.parse.urlencode({"data": query}).encode()
    last_error: Exception | None = None
    context = ssl_context()
    for url in OVERPASS_URLS:
        for attempt in range(3):
            request = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
            try:
                with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S, context=context) as resp:
                    return json.load(resp).get("elements", [])
            except urllib.error.HTTPError as exc:
                last_error = exc
                # Overpass returns 429 and 504 under load; both are worth retrying.
                if exc.code in (429, 502, 503, 504) and attempt < 2:
                    wait = 20 * (attempt + 1)
                    print(f"  {url}: HTTP {exc.code}; retrying in {wait}s")
                    time.sleep(wait)
                    continue
                print(f"  {url}: HTTP {exc.code} {exc.reason}")
                break
            except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as exc:
                last_error = exc
                if attempt < 2:
                    wait = 15 * (attempt + 1)
                    print(f"  {url}: {exc!r}; retrying in {wait}s")
                    time.sleep(wait)
                    continue
                print(f"  {url}: {exc!r}")
                break
        print("  Trying the next Overpass endpoint")
    raise RuntimeError(f"All Overpass endpoints failed; last error: {last_error!r}")


def to_venue(el: dict, name: str, ele: float) -> dict:
    tags = el.get("tags", {})
    slug = slugify(f"{name}-{el['id']}")
    # Non-Latin names slugify to just the id; prefer an English name for the
    # slug and display when OSM has one.
    english = tags.get("name:en")
    if english and not re.search(r"[a-z]", slugify(name)):
        slug = slugify(f"{english}-{el['id']}")
    display = name if not english or english == name else f"{english} ({name})"
    return {
        "slug": slug,
        "name": display,
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
            "Summit elevation from OpenStreetMap"
            + (f" · {tags['natural']}" if tags.get("natural") else "")
        ),
    }


def fetch_region(
    region: str,
    bbox: tuple[float, float, float, float],
    min_ele: float,
    max_count: int | None,
) -> list[dict]:
    print(f"\n[{region}] named summits in {bbox} with ele >= {min_ele:g} m")
    elements = fetch(build_query(bbox))
    print(f"  {len(elements):,} tagged summits returned")

    kept: list[dict] = []
    skipped = 0
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name")
        ele = parse_ele(tags.get("ele", ""))
        if not name or "lat" not in el:
            continue
        if ele is None or ele < min_ele:
            skipped += 1
            continue
        kept.append(to_venue(el, name, ele))

    kept.sort(key=lambda v: -v["summitM"])
    if max_count is not None and len(kept) > max_count:
        print(f"  keeping the tallest {max_count:,} of {len(kept):,}")
        kept = kept[:max_count]
    print(f"  {len(kept):,} kept, {skipped:,} below threshold or with unusable ele")
    return kept


def write(venues: list[dict]) -> int:
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
    return os.path.getsize(OUT_PATH)


def main(
    targets: list[tuple[str, tuple[float, float, float, float], float]],
    merge: bool,
    max_count: int | None,
) -> None:
    existing: dict[str, dict] = {}
    if merge and os.path.exists(OUT_PATH):
        with open(OUT_PATH, encoding="utf-8") as fh:
            for v in json.load(fh).get("venues", []):
                existing[v["slug"]] = v
        print(f"{len(existing):,} summits already in {os.path.basename(OUT_PATH)}")

    # Dedupe by OSM node id as well as slug, since a later run may pick an
    # English slug for a node first stored under its local-script name.
    by_osm = {v.get("osmId"): slug for slug, v in existing.items() if v.get("osmId")}

    failures: list[str] = []
    imported = 0
    for i, (region, bbox, min_ele) in enumerate(targets):
        if i:
            time.sleep(POLITE_PAUSE_S)
        try:
            venues = fetch_region(region, bbox, min_ele, max_count)
        except Exception as exc:  # report and carry on with the next region
            print(f"  FAILED: {exc}")
            failures.append(region)
            continue
        for v in venues:
            old_slug = by_osm.get(v["osmId"])
            if old_slug and old_slug != v["slug"]:
                existing.pop(old_slug, None)
            existing[v["slug"]] = v
            by_osm[v["osmId"]] = v["slug"]
        imported += len(venues)

    venues = sorted(existing.values(), key=lambda v: -(v.get("summitM") or 0))
    size = write(venues)

    print(f"\n{imported:,} imported this run")
    print(f"Wrote {os.path.relpath(OUT_PATH, REPO_ROOT)} with {len(venues):,} summits ({size / 1024:.0f} KB)")
    if size > SIZE_WARN_BYTES:
        print(
            f"  WARNING: over {SIZE_WARN_BYTES // (1024 * 1024)} MB. Raise --min-ele or set "
            "--max-per-region; every summit ends up in the venues.json the browser loads."
        )
    if venues:
        print("  Tallest:")
        for v in venues[:5]:
            print(f"    {v['summitM']:>5} m  {v['name']}")
    if failures:
        print(f"\nRegions that failed (file still written with the rest): {', '.join(failures)}")
    print("\nNext: python3 scripts/build_data.py")
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import OSM summits with elevations")
    parser.add_argument(
        "--region",
        help=f"One or more comma-separated presets: {', '.join(REGIONS)}",
    )
    parser.add_argument("--bbox", help="south,west,north,east in degrees")
    parser.add_argument(
        "--min-ele",
        type=float,
        help="Ignore summits below this height in metres (default: per region; 100 for --bbox)",
    )
    parser.add_argument(
        "--max-per-region",
        type=int,
        help="Keep only the tallest N summits from each region",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Discard existing peaks instead of merging these regions into them",
    )
    args = parser.parse_args()

    targets: list[tuple[str, tuple[float, float, float, float], float]] = []
    if args.bbox:
        parts = [float(x) for x in args.bbox.split(",")]
        if len(parts) != 4:
            sys.exit("--bbox needs four numbers: south,west,north,east")
        box = (parts[0], parts[1], parts[2], parts[3])
        targets.append(("bbox", box, args.min_ele if args.min_ele is not None else 100.0))
    if args.region:
        for name in [r.strip() for r in args.region.split(",") if r.strip()]:
            if name not in REGIONS:
                sys.exit(f"Unknown region {name!r}. Choose from: {', '.join(REGIONS)}")
            box, default_min = REGIONS[name]
            targets.append((name, box, args.min_ele if args.min_ele is not None else default_min))
    if not targets:
        sys.exit(f"Pass --region ({', '.join(REGIONS)}) or --bbox south,west,north,east")

    main(targets, merge=not args.replace, max_count=args.max_per_region)
