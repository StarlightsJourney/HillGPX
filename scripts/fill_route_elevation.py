#!/usr/bin/env python3
"""
Give committed routes without elevation real heights from terrain data.

Many GPX files (OSM route relations, planned routes) carry no <ele> at all,
so the site had to show "Elevation unavailable". This samples the public,
keyless AWS Terrain Tiles (Terrarium, ~38 m/px at zoom 12) at every track
point, writes the heights into the GPX, and records
`"elevationSource": "terrain"` in the route's sidecar so the site says where
the numbers came from. Files that already have varying elevation are left
alone. Singapore routes are re-sampled by build_data.py against the bundled
DEM regardless.

    python3 scripts/fill_route_elevation.py            # only files without elevation
    python3 scripts/fill_route_elevation.py --dry-run

Needs Pillow (scripts/requirements.txt). Then run build_data.py.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_peaks import ssl_context  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ROUTE_DIR = os.path.join(ROOT, "data", "routes")
TILE_URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"
ZOOM = 12
SIZE = 256
GPX_NS = "http://www.topografix.com/GPX/1/1"

_tiles: dict[tuple[int, int], list[float] | None] = {}


def tile(x: int, y: int) -> list[float] | None:
    if (x, y) not in _tiles:
        url = TILE_URL.format(z=ZOOM, x=x, y=y)
        try:
            with urllib.request.urlopen(url, context=ssl_context(), timeout=30) as resp:
                image = Image.open(io.BytesIO(resp.read())).convert("RGB")
            raw = image.tobytes()
            _tiles[(x, y)] = [raw[i] * 256 + raw[i + 1] + raw[i + 2] / 256 - 32768 for i in range(0, len(raw), 3)]
        except Exception as exc:  # report and leave the point unfilled
            print(f"  tile {x},{y}: {exc}")
            _tiles[(x, y)] = None
    return _tiles[(x, y)]


def height(lng: float, lat: float) -> float | None:
    scale = SIZE * 2**ZOOM
    s = math.sin(math.radians(max(-85.0, min(85.0, lat))))
    px = (lng + 180) / 360 * scale - 0.5
    py = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * scale - 0.5
    x0, y0 = math.floor(px), math.floor(py)
    fx, fy = px - x0, py - y0

    def at(x: int, y: int) -> float | None:
        data = tile(x // SIZE, y // SIZE)
        return None if data is None else data[(y % SIZE) * SIZE + (x % SIZE)]

    a, b, c, d = at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)
    if None in (a, b, c, d):
        return None
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy  # type: ignore[operator]


def main(dry_run: bool) -> None:
    ET.register_namespace("", GPX_NS)
    for filename in sorted(f for f in os.listdir(ROUTE_DIR) if f.endswith(".gpx")):
        path = os.path.join(ROUTE_DIR, filename)
        tree = ET.parse(path)
        points = [el for el in tree.iter() if el.tag.endswith("trkpt") or el.tag.endswith("rtept")]
        heights = []
        for el in points:
            ele = next((c for c in el if c.tag.endswith("ele")), None)
            heights.append(float(ele.text) if ele is not None and ele.text else 0.0)
        if points and max(heights) - min(heights) >= 1:
            continue
        print(f"{filename}: {len(points)} points without elevation")
        if dry_run:
            continue
        filled = 0
        for el in points:
            value = height(float(el.get("lon")), float(el.get("lat")))
            if value is None:
                continue
            ele = next((c for c in el if c.tag.endswith("ele")), None)
            if ele is None:
                ele = ET.SubElement(el, f"{{{GPX_NS}}}ele" if el.tag.startswith("{") else "ele")
                el.remove(ele)
                el.insert(0, ele)
            ele.text = f"{value:.1f}"
            filled += 1
        if filled < len(points):
            print(f"  only {filled}/{len(points)} points filled; leaving the file unchanged")
            continue
        tree.write(path, encoding="UTF-8", xml_declaration=True)
        sidecar = os.path.splitext(path)[0] + ".json"
        meta = {}
        if os.path.exists(sidecar):
            with open(sidecar, encoding="utf-8") as fh:
                meta = json.load(fh)
        meta["elevationSource"] = "terrain"
        with open(sidecar, "w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        print(f"  filled from terrain; sidecar marked elevationSource=terrain")
    print("Next: python3 scripts/build_data.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fill missing route elevation from terrain tiles")
    parser.add_argument("--dry-run", action="store_true")
    main(parser.parse_args().dry_run)
