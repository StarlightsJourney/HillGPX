#!/usr/bin/env python3
"""
Build worldwide summit tiles from the GeoNames gazetteer.

Overpass cannot serve the whole planet's peaks in reasonable time, so the
world layer comes from GeoNames' single daily dump instead: every named peak,
mountain, hill and volcano on Earth, with an elevation (surveyed where known,
SRTM otherwise). Licence CC BY 4.0, credited on the site.

The output is split into 5° tiles that the map loads only for what is on
screen, plus a small index with per-tile counts and the tallest few summits
of each tile for the zoomed-out view:

    public/data/peaks/index.json
    public/data/peaks/<south>_<west>.json

Summits already in data/venues/peaks.json or hills.json (OSM/curated, better
names and links) are skipped when a GeoNames entry sits within 300 m.

    python3 scripts/fetch_world_peaks.py              # downloads the dump once
    python3 scripts/fetch_world_peaks.py --min-ele 300

Standard library only; no key.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import shutil
import urllib.request
import zipfile
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(SCRIPT_DIR, "..")
CACHE = os.path.join(SCRIPT_DIR, ".cache", "geonames-allCountries.zip")
DUMP_URL = "https://download.geonames.org/export/dump/allCountries.zip"
OUT_DIR = os.path.join(ROOT, "public", "data", "peaks")
EXISTING = [os.path.join(ROOT, "data", "venues", f) for f in ("peaks.json", "hills.json")]

TILE = 5
TOP_PER_TILE = 4
FEATURES = {"PK", "PKS", "MT", "MTS", "HLL", "HLLS", "VLC"}
DEDUPE_M = 300


def download() -> None:
    if os.path.exists(CACHE):
        return
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    print(f"Downloading {DUMP_URL} (~420 MB, once)…")
    from fetch_peaks import ssl_context  # noqa: E402  (local import keeps this script standalone otherwise)

    with urllib.request.urlopen(DUMP_URL, context=ssl_context()) as resp, open(CACHE + ".part", "wb") as fh:
        shutil.copyfileobj(resp, fh, 1 << 20)
    os.replace(CACHE + ".part", CACHE)


def existing_cells() -> dict[tuple[int, int], list[tuple[float, float]]]:
    """Known summits bucketed on a ~0.01° grid for a cheap proximity check."""
    cells: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    for path in EXISTING:
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            for v in json.load(fh).get("venues", []):
                cells[(int(v["lat"] * 100), int(v["lng"] * 100))].append((v["lat"], v["lng"]))
    return cells


def near_existing(cells: dict, lat: float, lng: float) -> bool:
    cy, cx = int(lat * 100), int(lng * 100)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for la, ln in cells.get((cy + dy, cx + dx), ()):
                dlat = math.radians(la - lat)
                dlng = math.radians(ln - lng) * math.cos(math.radians(lat))
                if 6_371_000 * math.hypot(dlat, dlng) < DEDUPE_M:
                    return True
    return False


def main(min_ele: float) -> None:
    import sys

    sys.path.insert(0, SCRIPT_DIR)
    download()
    known = existing_cells()
    tiles: dict[str, list[list]] = defaultdict(list)
    kept = skipped_dupe = 0
    countries: set[str] = set()
    # code -> [count, west, south, east, north] for the landing banner and rows.
    by_country: dict[str, list[float]] = {}

    with zipfile.ZipFile(CACHE) as archive, archive.open("allCountries.txt") as raw:
        for line in io.TextIOWrapper(raw, encoding="utf-8"):
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 17 or cols[6] != "T" or cols[7] not in FEATURES:
                continue
            surveyed = cols[15].strip()
            dem = cols[16].strip()
            ele = int(surveyed) if surveyed.lstrip("-").isdigit() else None
            source = "s"
            if ele is None and dem.lstrip("-").isdigit() and int(dem) > -9000:
                ele, source = int(dem), "d"
            if ele is None or ele < min_ele or ele > 8850:
                continue
            lat, lng = float(cols[4]), float(cols[5])
            if near_existing(known, lat, lng):
                skipped_dupe += 1
                continue
            name = cols[1].strip() or cols[2].strip()
            if not name:
                continue
            south = math.floor(lat / TILE) * TILE
            west = math.floor(lng / TILE) * TILE
            # [geonameid, name, lat, lng, elevation m, s(urveyed)|d(em), country, feature]
            tiles[f"{south}_{west}"].append(
                [int(cols[0]), name, round(lat, 5), round(lng, 5), ele, source, cols[8], cols[7]]
            )
            countries.add(cols[8])
            if cols[8]:
                c = by_country.setdefault(cols[8], [0, lng, lat, lng, lat])
                c[0] += 1
                c[1], c[2], c[3], c[4] = min(c[1], lng), min(c[2], lat), max(c[3], lng), max(c[4], lat)
            kept += 1

    if os.path.isdir(OUT_DIR):
        shutil.rmtree(OUT_DIR)
    os.makedirs(OUT_DIR)
    index = {
        "tile": TILE,
        "total": kept,
        "countries": len(countries),
        "byCountry": {k: [int(v[0])] + [round(x, 2) for x in v[1:]] for k, v in by_country.items()},
        "cells": {},
        "top": [],
    }
    total_bytes = 0
    for key, peaks in tiles.items():
        peaks.sort(key=lambda p: -p[4])
        index["cells"][key] = len(peaks)
        index["top"].extend(peaks[:TOP_PER_TILE])
        path = os.path.join(OUT_DIR, f"{key}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(peaks, fh, ensure_ascii=False, separators=(",", ":"))
        total_bytes += os.path.getsize(path)
    index["top"].sort(key=lambda p: -p[4])
    with open(os.path.join(OUT_DIR, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(",", ":"))

    biggest = max(tiles, key=lambda k: len(tiles[k])) if tiles else None
    print(f"{kept:,} summits in {len(tiles):,} tiles across {len(countries)} countries ({total_bytes / 1e6:.1f} MB)")
    print(f"{skipped_dupe:,} skipped as already mapped from OSM/curated data")
    if biggest:
        print(f"Densest tile {biggest}: {len(tiles[biggest]):,} summits")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build worldwide summit tiles from GeoNames")
    parser.add_argument("--min-ele", type=float, default=100, help="Ignore summits below this elevation (m)")
    main(parser.parse_args().min_ele)
