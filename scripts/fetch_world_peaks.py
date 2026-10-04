#!/usr/bin/env python3
"""
Build worldwide summit tiles from the GeoNames gazetteer.

Overpass cannot serve the whole planet's peaks in reasonable time, so the
world layer comes from GeoNames' single daily dump instead: every named peak,
mountain, hill and volcano on Earth, with an elevation (surveyed where known,
SRTM otherwise). Licence CC BY 4.0, credited on the site.

The output is split into 5° tiles that the map loads only for what is on
screen, plus a small index with per-tile counts, a box per country, and
highlights: the tallest few summits of each tile (the zoomed-out map) plus the
tallest dozen of every country (the landing rows; a flat country such as
Finland would otherwise get only the handful that top their tiles):

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
TOP_PER_COUNTRY = 12
# A country's landing row counts mountains, not every named point on one:
# a summit this close to a taller pick (Monte Rosa's dozen sub-peaks) is
# skipped, and so are ranges (MTS, HLLS, PKS), whose point is a centroid.
DISTINCT_M = 3000
RANGES = {"MTS", "HLLS", "PKS"}
# Country boxes drop this share of outlying summits on each side (remote
# islands, a stray Aleutian rock) so "See all" frames where the peaks are.
TRIM = 0.005
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


def country_box(points: list[tuple[float, float]], keep: list[tuple[float, float]]) -> list[float]:
    """
    [west, south, east, north] around a country's summits, the tight way round
    the globe.

    A plain min/max box spans the whole planet for any country that crosses
    the antimeridian (the US, New Zealand, Russia, Fiji…). Instead the box
    starts after the widest empty arc of longitude, so `east` may exceed 180
    (MapLibre's fitBounds takes that as "carry on east"). Outliers are trimmed,
    but every summit in `keep` (the tallest, shown on the landing) stays in.
    """
    lngs = sorted({round(lng, 3) for lng, _ in points})
    if len(lngs) > 1:
        gaps = [(lngs[i + 1] - lngs[i], lngs[i + 1]) for i in range(len(lngs) - 1)]
        gaps.append((lngs[0] + 360 - lngs[-1], lngs[0]))
        origin = max(gaps)[1]
    else:
        origin = lngs[0]
    # Just below the rounded edge, so the westernmost summit is not taken as 359.9995° east of it.
    origin -= 0.001

    def shift(lng: float) -> float:
        return (lng - origin) % 360

    xs = sorted(shift(lng) for lng, _ in points)
    ys = sorted(lat for _, lat in points)
    cut = int(len(xs) * TRIM) if len(xs) >= 100 else 0
    x0, x1 = xs[cut], xs[-1 - cut]
    y0, y1 = ys[cut], ys[-1 - cut]
    for lng, lat in keep:
        x = shift(lng)
        x0, x1, y0, y1 = min(x0, x), max(x1, x), min(y0, lat), max(y1, lat)
    # A lone summit still needs a box the map can frame.
    pad = 0.05
    if x1 - x0 < 2 * pad:
        x0, x1 = (x0 + x1) / 2 - pad, (x0 + x1) / 2 + pad
    if y1 - y0 < 2 * pad:
        y0, y1 = (y0 + y1) / 2 - pad, (y0 + y1) / 2 + pad
    if x1 - x0 > 180:
        # Summits all the way round (Antarctica): no tight box exists.
        return [-180, round(y0, 2), 180, round(y1, 2)]
    west = (origin + x0 + 180) % 360 - 180
    return [round(west, 2), round(y0, 2), round(west + (x1 - x0), 2), round(y1, 2)]


def distance_m(a: list, b: list) -> float:
    dlat = math.radians(a[2] - b[2])
    dlng = math.radians(a[3] - b[3]) * math.cos(math.radians((a[2] + b[2]) / 2))
    return 6_371_000 * math.hypot(dlat, dlng)


def landing_row(rows: list[list]) -> list[list]:
    """The country's tallest distinct summits, highest first (rows sorted already)."""
    picked: list[list] = []
    for row in rows:
        if row[7] in RANGES or any(distance_m(row, p) < DISTINCT_M for p in picked):
            continue
        picked.append(row)
        if len(picked) == TOP_PER_COUNTRY:
            break
    return picked


def main(min_ele: float) -> None:
    import sys

    sys.path.insert(0, SCRIPT_DIR)
    download()
    known = existing_cells()
    tiles: dict[str, list[list]] = defaultdict(list)
    kept = skipped_dupe = 0
    countries: set[str] = set()
    # code -> (lng, lat) of every summit, for the per-country box and highlights.
    by_country: dict[str, list[tuple[float, float]]] = defaultdict(list)
    tallest: dict[str, list[list]] = defaultdict(list)

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
            row = [int(cols[0]), name, round(lat, 5), round(lng, 5), ele, source, cols[8], cols[7]]
            tiles[f"{south}_{west}"].append(row)
            countries.add(cols[8])
            if cols[8]:
                by_country[cols[8]].append((lng, lat))
                tallest[cols[8]].append(row)
            kept += 1

    # Replace the tiles and index only: photos.json (fetch_peak_photos.py) lives here too.
    os.makedirs(OUT_DIR, exist_ok=True)
    for name in os.listdir(OUT_DIR):
        if name == "index.json" or (name.endswith(".json") and "_" in name):
            os.remove(os.path.join(OUT_DIR, name))
    for code, rows in tallest.items():
        rows.sort(key=lambda p: (-p[4], p[0]))
        tallest[code] = landing_row(rows)
    index = {
        "tile": TILE,
        "total": kept,
        "countries": len(countries),
        "byCountry": {
            k: [len(v)] + country_box(v, [(r[3], r[2]) for r in tallest[k]]) for k, v in sorted(by_country.items())
        },
        # code -> geonameids of its landing row, highest first (all are in "top").
        "rows": {k: [r[0] for r in v] for k, v in sorted(tallest.items())},
        "cells": {},
        "top": [],
    }
    total_bytes = 0
    top: dict[int, list] = {}
    for key, peaks in tiles.items():
        peaks.sort(key=lambda p: -p[4])
        index["cells"][key] = len(peaks)
        for p in peaks[:TOP_PER_TILE]:
            top[p[0]] = p
        path = os.path.join(OUT_DIR, f"{key}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(peaks, fh, ensure_ascii=False, separators=(",", ":"))
        total_bytes += os.path.getsize(path)
    for rows in tallest.values():
        for p in rows:
            top[p[0]] = p
    index["top"] = sorted(top.values(), key=lambda p: (-p[4], p[0]))
    with open(os.path.join(OUT_DIR, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(",", ":"))

    biggest = max(tiles, key=lambda k: len(tiles[k])) if tiles else None
    print(f"{kept:,} summits in {len(tiles):,} tiles across {len(countries)} countries ({total_bytes / 1e6:.1f} MB)")
    print(f"{len(index['top']):,} highlights in the index ({os.path.getsize(os.path.join(OUT_DIR, 'index.json')) / 1e3:.0f} kB)")
    print(f"{skipped_dupe:,} skipped as already mapped from OSM/curated data")
    if biggest:
        print(f"Densest tile {biggest}: {len(tiles[biggest]):,} summits")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build worldwide summit tiles from GeoNames")
    parser.add_argument("--min-ele", type=float, default=100, help="Ignore summits below this elevation (m)")
    main(parser.parse_args().min_ele)
