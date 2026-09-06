#!/usr/bin/env python3
"""
HillMapper — HDB block ingestion.

Pulls HDB block data from data.gov.sg, geocodes it via the OneMap Search API,
and writes a plain JSON file that `build_data.py` folds into the app's static
dataset. There is no database: the output is a file you commit, so a correction
to a block is a reviewable pull request rather than an invisible UPDATE.

This is slow (~13k blocks at 250 ms per geocode) and only needs re-running when
HDB publishes new data — roughly annually. Results are cached in
scripts/.cache/geocode.json, so an interrupted run resumes almost instantly and
a re-run only geocodes blocks it has never seen.

Usage:
    pip install -r scripts/requirements.txt
    python scripts/ingest_hdb.py [--limit N]

Environment variables (from ../.env.local — see .env.example):
    ONEMAP_TOKEN     (recommended: a OneMap API token)
    ONEMAP_EMAIL     (alternative: email + password, token fetched per run)
    ONEMAP_PASSWORD

NOTE ON DATA LICENSING: HDB property data comes from data.gov.sg under the
Singapore Open Data Licence, which requires attribution. Coordinates are derived
from OneMap. Before redistributing the generated coordinates, check OneMap's
current terms of use — bulk redistribution of derived geocodes is the one part
of this pipeline whose licensing is not obviously settled.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.join(SCRIPT_DIR, "..")
ENV_PATH = os.path.join(REPO_ROOT, ".env.local")
load_dotenv(ENV_PATH)

CACHE_DIR = os.path.join(SCRIPT_DIR, ".cache")
GEOCODE_CACHE_PATH = os.path.join(CACHE_DIR, "geocode.json")
OUT_PATH = os.path.join(REPO_ROOT, "data", "venues", "hdb-blocks.json")

ONEMAP_EMAIL = os.environ.get("ONEMAP_EMAIL")
ONEMAP_PASSWORD = os.environ.get("ONEMAP_PASSWORD")
ONEMAP_TOKEN = os.environ.get("ONEMAP_TOKEN")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HDB_PROPERTY_RESOURCE_ID = "d_17f5382f26140b1fdae0ba2ef6239d2f"
DATA_GOV_URL = "https://data.gov.sg/api/action/datastore_search"
ONEMAP_AUTH_URL = "https://www.onemap.gov.sg/api/auth/post/getToken"
ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search"

FLOOR_HEIGHT_M = 2.8
ONEMAP_DELAY_S = 0.25  # 250 ms between OneMap calls (well under 300/min limit)
BATCH_SIZE = 500  # upsert batch size

# Street abbreviation map (applied BEFORE geocoding/joining).
# OneMap uses full spellings — we expand SG abbreviations to full names.
# Order matters: longer patterns first to avoid partial matches (e.g. C'WEALTH
# before STH, ST. before ST).
STREET_ABBREVIATIONS: dict[str, str] = {
    # Contractions
    r"\bS'GOON\b":     "SERANGOON",
    r"\bC'WEALTH\b":   "COMMONWEALTH",
    r"\bT'PANGS\b":    "TAMPINES",
    r"\bBT\s+?MERAH\b": "BUKIT MERAH",  # "BT MERAH" is common
    r"\bBT\s+?BATOK\b": "BUKIT BATOK",
    r"\bBT\s+?PANJANG\b": "BUKIT PANJANG",
    r"\bBT\s+?TIMAH\b": "BUKIT TIMAH",
    # Cardinals / prefixes
    r"\bSTH\b":         "SOUTH",
    r"\bNTH\b":         "NORTH",
    r"\bUPP\b":         "UPPER",
    r"\bLOW\b":         "LOWER",
    r"\bCTRL\b":        "CENTRAL",
    # SAINT (must be before ST→STREET — SG uses "ST." for Saint streets)
    r"\bST\.\s?":       "SAINT ",
    # Street type suffixes
    r"\bST\b":          "STREET",
    r"\bAVE\b":         "AVENUE",
    r"\bRD\b":          "ROAD",
    r"\bDR\b":          "DRIVE",
    r"\bCRES\b":        "CRESCENT",
    r"\bLN\b":          "LANE",
    r"\bCL\b":          "CLOSE",
    r"\bPL\b":          "PLACE",
    r"\bGDNS\b":        "GARDENS",
    r"\bHTS\b":         "HEIGHTS",
    r"\bPK\b":          "PARK",
    r"\bTER\b":         "TERRACE",
    r"\bWK\b":          "WALK",
    # Other common abbreviations
    r"\bJLN\b":         "JALAN",
    r"\bKG\b":          "KAMPONG",
    r"\bTG\b":          "TANJONG",
    r"\bBT\b":          "BUKIT",
    r"\bCTR\b":         "CENTRE",
    r"\bTWN\b":         "TOWN",
}

# ---------------------------------------------------------------------------
# Step 2 — Address Standardization
# ---------------------------------------------------------------------------


def standardize_blk_no(blk_no: str) -> str:
    """Normalize a block number.

    - Strip leading zeros: ``Blk 012`` -> ``12``
    - Standardise suffix letters: ``1a`` / ``1 A`` -> ``1A``
    - Remove any ``Blk`` / ``BLK`` prefix
    """
    blk = blk_no.strip()

    # Strip optional "Blk" prefix (case-insensitive)
    if blk.upper().startswith("BLK "):
        blk = blk[4:].strip()
    elif blk.upper().startswith("BLK"):
        blk = blk[3:].strip()

    # Split into numeric part and optional letter suffix
    m = re.match(r"^(\d+)([A-Za-z]?)$", blk)
    if m:
        digits = m.group(1).lstrip("0") or "0"
        suffix = m.group(2).upper()
        return digits + suffix

    return blk


def standardize_blk_suffix(blk_no: str) -> str:
    """Normalise whitespace/case in suffix letters: ``1 A`` -> ``1A``, ``1a`` -> ``1A``."""
    result = re.sub(r"(\d+)\s+([A-Za-z])$", r"\1\2", blk_no)
    result = re.sub(r"(\d+)([a-z])$", lambda m: m.group(1) + m.group(2).upper(), result)
    return result


def standardize_street(street: str) -> str:
    """Expand common street abbreviations via regex substitution."""
    result = street.strip()
    for pattern, replacement in STREET_ABBREVIATIONS.items():
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    return result


def standardize_address(blk_no: str, street: str) -> tuple[str, str]:
    """Full address standardisation (both blk_no and street)."""
    blk = standardize_blk_no(blk_no)
    blk = standardize_blk_suffix(blk)
    street = standardize_street(street)
    return blk, street


# ---------------------------------------------------------------------------
# Step 1 — Data Pull
# ---------------------------------------------------------------------------


def pull_dataset(resource_id: str, page_size: int = 500) -> list[dict]:
    """Fetch all records from a data.gov.sg CKAN resource using pagination.

    Respects rate limits: 1-second delay between pages, retries on 429/5xx.
    """
    all_records: list[dict] = []
    offset = 0
    max_retries = 3

    print(f"  Fetching (page size={page_size})...")

    while True:
        url = f"{DATA_GOV_URL}?resource_id={resource_id}&limit={page_size}&offset={offset}"

        for attempt in range(max_retries):
            try:
                resp = requests.get(url, timeout=30)

                if resp.status_code == 429:
                    wait = 5 * (attempt + 1)
                    print(f"  Rate limited — waiting {wait}s...")
                    time.sleep(wait)
                    continue

                resp.raise_for_status()
                break
            except requests.exceptions.RequestException as e:
                if attempt < max_retries - 1:
                    wait = 2 * (attempt + 1)
                    print(f"  Request failed ({e}) — retrying in {wait}s...")
                    time.sleep(wait)
                else:
                    raise

        result = resp.json()["result"]
        records = result["records"]
        total = result.get("total", 0)

        if not records:
            break

        all_records.extend(records)
        offset += page_size
        print(f"  ... {len(all_records):,} / {total:,} records")

        if offset >= total:
            break

        # Be polite to the API
        time.sleep(1)

    return all_records


# ---------------------------------------------------------------------------
# OneMap Authentication & Geocoding
# ---------------------------------------------------------------------------


def get_onemap_token() -> str:
    """Obtain a OneMap API access token.

    Uses ``ONEMAP_TOKEN`` directly if set in the environment, otherwise
    authenticates via ``ONEMAP_EMAIL`` + ``ONEMAP_PASSWORD``.
    """
    if ONEMAP_TOKEN:
        print("  Using ONEMAP_TOKEN from environment")
        return ONEMAP_TOKEN

    if not ONEMAP_EMAIL or not ONEMAP_PASSWORD:
        print(
            "FATAL: Either ONEMAP_TOKEN or both ONEMAP_EMAIL and "
            "ONEMAP_PASSWORD must be set in .env.local"
        )
        sys.exit(1)

    print("  Authenticating with OneMap ...")
    resp = requests.post(
        ONEMAP_AUTH_URL,
        json={"email": ONEMAP_EMAIL, "password": ONEMAP_PASSWORD},
        timeout=10,
    )
    resp.raise_for_status()
    body = resp.json()
    token = body.get("access_token")
    if not token:
        print(f"FATAL: OneMap auth response missing access_token: {resp.text}")
        sys.exit(1)
    print("  OneMap authentication successful")
    return token


def geocode_onemap_search(query: str, token: str) -> tuple[float, float] | None:
    """Resolve an address string to (lat, lng) via OneMap Search API."""
    headers = {"Authorization": f"Bearer {token}"}
    params = {"searchVal": query, "returnGeom": "Y", "getAddrDetails": "Y"}
    try:
        resp = requests.get(ONEMAP_SEARCH_URL, headers=headers, params=params, timeout=10)
        resp.raise_for_status()
        results = resp.json().get("results", [])
        if results:
            r = results[0]
            return float(r["LATITUDE"]), float(r["LONGITUDE"])
    except (requests.RequestException, KeyError, ValueError, TypeError):
        pass
    return None


# ---------------------------------------------------------------------------
# Geocode cache
#
# A full run is ~13k OneMap calls at 250 ms apiece — the better part of an hour.
# Caching by standardised address means an interrupted run resumes for free and
# an annual refresh only pays for blocks that are genuinely new.
# ---------------------------------------------------------------------------


def load_geocode_cache() -> dict[str, list[float]]:
    if not os.path.exists(GEOCODE_CACHE_PATH):
        return {}
    try:
        with open(GEOCODE_CACHE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"  Warning: could not read geocode cache ({exc}); starting fresh")
        return {}


def save_geocode_cache(cache: dict[str, list[float]]) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = GEOCODE_CACHE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cache, fh)
    os.replace(tmp, GEOCODE_CACHE_PATH)


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def write_venues(records: list[dict]) -> int:
    """Write geocoded residential blocks out as venue JSON.

    Blocks that failed geocoding are dropped rather than written with null
    coordinates: this file feeds a map, and a venue with no location cannot be
    shown. They are reported in the summary and listed in the `unmatched` key so
    nothing disappears silently.
    """
    venues: list[dict] = []
    unmatched: list[dict] = []

    for r in records:
        blk, street = r["_std_blk"], r["_std_street"]
        base = {
            "blkNo": blk,
            "street": street,
            "town": (r.get("bldg_contract_town") or None),
            "storeys": r["_storeys"],
            "yearCompleted": _safe_int(r.get("year_completed")),
        }

        if not r.get("_geocoded"):
            unmatched.append({**base, "reason": "OneMap geocoding returned no result"})
            continue

        venues.append({
            **base,
            "slug": _slugify(f"blk-{blk}-{street}"),
            "name": f"Blk {blk} {_title_case(street)}",
            "type": "hdb_block",
            "lat": r["_lat"],
            "lng": r["_lng"],
            # Storey count times a typical floor-to-floor height. This is an
            # estimate and is labelled as one everywhere it surfaces.
            "gainM": r["_est_height"],
            "summitM": None,
            "elevationSource": "estimated",
        })

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "HDB Property Information, data.gov.sg (Singapore Open Data Licence); "
                  "coordinates via OneMap",
        "floorHeightM": FLOOR_HEIGHT_M,
        "venues": venues,
        "unmatched": unmatched,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=False)

    return len(venues)


def _slugify(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")


def _title_case(street: str) -> str:
    """`ANG MO KIO AVENUE 4` -> `Ang Mo Kio Avenue 4`, leaving digits alone."""
    return " ".join(w if w.isdigit() else w.capitalize() for w in street.split())


# ---------------------------------------------------------------------------
# Misc Helpers
# ---------------------------------------------------------------------------


def _safe_int(val) -> int | None:
    """Convert *val* to int, returning None on failure."""
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Main Orchestration
# ---------------------------------------------------------------------------


def main(limit: int | None = None) -> None:
    print("=" * 60)
    print("HillMapper — HDB block ingestion")
    print(f"Started at: {datetime.now().isoformat()}")
    print("=" * 60)

    counts: dict[str, int] = {}

    # ── Step 1: Pull & Filter ──────────────────────────────────────────────
    print("\n--- Step 1: Pull & Filter ---")

    records = pull_dataset(HDB_PROPERTY_RESOURCE_ID)
    counts["total"] = len(records)

    residential = [
        r for r in records
        if r.get("residential", "").strip().upper() == "Y"
    ]
    if limit is not None:
        residential = residential[:limit]
        print(f"  --limit {limit}: processing a subset only")
    counts["residential"] = len(residential)
    print(f"  Pulled {counts['total']} rows, "
          f"{counts['residential']} residential")

    # Compute derived fields and standardize addresses
    print("\n--- Step 2: Address Standardization ---")

    for r in residential:
        storeys = _safe_int(r.get("max_floor_lvl"))
        r["_storeys"] = storeys
        r["_est_height"] = round(storeys * FLOOR_HEIGHT_M, 1) if storeys else None

        blk = (r.get("blk_no") or "").strip()
        st = (r.get("street") or "").strip()
        r["_std_blk"], r["_std_street"] = standardize_address(blk, st)

        r["_geocoded"] = False

    print(f"  Standardized {len(residential)} addresses")

    # ── Step 3: OneMap Geocoding ─────────────────────────────────────────
    print("\n--- Step 3: OneMap Geocoding ---")

    cache = load_geocode_cache()
    print(f"  Geocode cache: {len(cache):,} addresses already resolved")

    # Only authenticate if there is actually something left to look up.
    needs_lookup = [
        r for r in residential if f"{r['_std_blk']} {r['_std_street']}" not in cache
    ]
    token = get_onemap_token() if needs_lookup else ""
    if not needs_lookup:
        print("  Every address is cached — skipping OneMap entirely")

    total = len(residential)
    matched = 0
    fetched = 0

    for idx, r in enumerate(residential):
        address = f"{r['_std_blk']} {r['_std_street']}"

        if address in cache:
            result = tuple(cache[address]) if cache[address] else None
        else:
            result = geocode_onemap_search(address, token)
            cache[address] = list(result) if result else []
            fetched += 1
            time.sleep(ONEMAP_DELAY_S)

            # Checkpoint periodically so an interrupted run keeps its progress.
            if fetched % 200 == 0:
                save_geocode_cache(cache)

        if result:
            r["_lat"], r["_lng"] = result
            r["_geocoded"] = True
            matched += 1

        if (idx + 1) % 500 == 0 or idx == total - 1:
            print(f"  ... {idx + 1:,} / {total:,}  ({matched:,} matched, {fetched:,} fetched)")

    save_geocode_cache(cache)
    counts["OneMap_matched"] = matched
    print(f"  OneMap matched: {matched:,} / {total:,}")

    # Final tally
    geocoded = [r for r in residential if r["_geocoded"]]
    unmatched = [r for r in residential if not r["_geocoded"]]
    counts["geocoded"] = len(geocoded)
    counts["unmatched"] = len(unmatched)

    # ── Step 4: Write venue JSON ───────────────────────────────────────────
    print("\n--- Step 4: Write venue JSON ---")
    written = write_venues(residential)
    print(f"  Wrote {written:,} blocks to {os.path.relpath(OUT_PATH, REPO_ROOT)}")

    # ── Summary ────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Total records pulled:           {counts['total']:,}")
    print(f"  Residential (filtered):         {counts['residential']:,}")
    print(f"  Geocoded — OneMap:              {counts.get('OneMap_matched', 0):,}")
    print(f"  Written to JSON:                {written:,}")
    print(f"  Unmatched (dropped, logged):    {counts['unmatched']:,}")
    print(f"Finished at: {datetime.now().isoformat()}")
    print("=" * 60)
    print("\nNext: python scripts/build_data.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest HDB blocks into data/venues/hdb-blocks.json")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N residential blocks — useful for a quick smoke test.",
    )
    args = parser.parse_args()
    main(limit=args.limit)
