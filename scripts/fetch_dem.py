#!/usr/bin/env python3
"""
Fetch a terrain model for Singapore and bake it into a static asset.

    python scripts/fetch_dem.py

Why this exists: the elevation recorded in a GPX file is consumer-GPS altitude,
which is noisy enough that naively summing its deltas overstates climbing badly.
To report gain honestly you need a terrain model. Singapore is small enough
(~50 x 27 km) that the whole country at ~38 m resolution is a few megabytes —
small enough to ship with the app, so elevation profiles work with no API, no
key, no rate limit, and offline.

Source: the AWS Open Data terrain tiles (Terrarium encoding), which are public
and need no account. Elevation is encoded in the RGB channels as
    (R * 256 + G + B / 256) - 32768
See https://registry.opendata.aws/terrain-tiles/ — derived from SRTM and other
open sources. Attribution is written into the output header.

Output:
    public/data/dem/sg-dem.json   header (bounds, dimensions, attribution)
    public/data/dem/sg-dem.bin    little-endian int16 metres, row-major, N->S

Dependencies: Pillow (see requirements.txt).
"""

from __future__ import annotations

import argparse
import array
import io
import json
import math
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install -r scripts/requirements.txt")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "..", "public", "data", "dem")

# Singapore, with a little margin so coastal routes are not clipped.
WEST, SOUTH, EAST, NORTH = 103.58, 1.18, 104.12, 1.50

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
TILE_SIZE = 256
NO_DATA = -32768

ATTRIBUTION = (
    "Elevation: AWS Open Data terrain tiles (Terrarium), derived from SRTM and "
    "other open sources. https://registry.opendata.aws/terrain-tiles/"
)


def lng_to_tile_x(lng: float, z: int) -> float:
    return (lng + 180.0) / 360.0 * (1 << z)


def lat_to_tile_y(lat: float, z: int) -> float:
    rad = math.radians(lat)
    return (1.0 - math.asinh(math.tan(rad)) / math.pi) / 2.0 * (1 << z)


def tile_y_to_lat(y: float, z: int) -> float:
    n = math.pi * (1 - 2 * y / (1 << z))
    return math.degrees(math.atan(math.sinh(n)))


def fetch_tile(z: int, x: int, y: int) -> Image.Image | None:
    url = TILE_URL.format(z=z, x=x, y=y)
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            return Image.open(io.BytesIO(resp.read())).convert("RGB")
    except Exception as exc:  # noqa: BLE001 — any failure means "use no-data"
        print(f"  Warning: tile {z}/{x}/{y} failed ({exc})")
        return None


def main(zoom: int) -> None:
    x0 = int(math.floor(lng_to_tile_x(WEST, zoom)))
    x1 = int(math.floor(lng_to_tile_x(EAST, zoom)))
    y0 = int(math.floor(lat_to_tile_y(NORTH, zoom)))
    y1 = int(math.floor(lat_to_tile_y(SOUTH, zoom)))

    cols, rows = x1 - x0 + 1, y1 - y0 + 1
    print(f"Fetching {cols * rows} tiles at z={zoom} ({cols} x {rows})")

    mosaic = Image.new("RGB", (cols * TILE_SIZE, rows * TILE_SIZE))
    coords = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]

    with ThreadPoolExecutor(max_workers=8) as pool:
        tiles = list(pool.map(lambda c: fetch_tile(zoom, c[0], c[1]), coords))

    for (x, y), tile in zip(coords, tiles):
        if tile is not None:
            mosaic.paste(tile, ((x - x0) * TILE_SIZE, (y - y0) * TILE_SIZE))

    # Geographic extent of the assembled mosaic (mercator in y).
    m_west = (x0 / (1 << zoom)) * 360.0 - 180.0
    m_east = ((x1 + 1) / (1 << zoom)) * 360.0 - 180.0
    m_north = tile_y_to_lat(y0, zoom)
    m_south = tile_y_to_lat(y1 + 1, zoom)

    px = mosaic.load()
    m_width, m_height = mosaic.size

    # Resample the mercator mosaic onto a grid that is linear in latitude, which
    # is what the app's sampler assumes. Near the equator the correction is tiny,
    # but doing it here keeps the client-side code simple and correct.
    out_width = int((EAST - WEST) / (m_east - m_west) * m_width)
    out_height = int(out_width * (NORTH - SOUTH) / (EAST - WEST))
    grid = array.array("h", [NO_DATA]) * (out_width * out_height)

    for row in range(out_height):
        lat = NORTH - (NORTH - SOUTH) * row / max(out_height - 1, 1)
        merc_y = lat_to_tile_y(lat, zoom)
        py = int(round((merc_y - y0) * TILE_SIZE))
        if not (0 <= py < m_height):
            continue
        for col in range(out_width):
            lng = WEST + (EAST - WEST) * col / max(out_width - 1, 1)
            pxx = int(round((lng_to_tile_x(lng, zoom) - x0) * TILE_SIZE))
            if not (0 <= pxx < m_width):
                continue
            r, g, b = px[pxx, py]
            elevation = (r * 256 + g + b / 256) - 32768
            # Clamp: Terrarium encodes ocean as small negatives, and nothing in
            # Singapore is below sea level or above a few hundred metres.
            grid[row * out_width + col] = max(-100, min(9000, int(round(elevation))))

    os.makedirs(OUT_DIR, exist_ok=True)

    if sys.byteorder == "big":
        grid.byteswap()
    with open(os.path.join(OUT_DIR, "sg-dem.bin"), "wb") as fh:
        fh.write(grid.tobytes())

    header = {
        "west": WEST,
        "south": SOUTH,
        "east": EAST,
        "north": NORTH,
        "width": out_width,
        "height": out_height,
        "noData": NO_DATA,
        "attribution": ATTRIBUTION,
    }
    with open(os.path.join(OUT_DIR, "sg-dem.json"), "w", encoding="utf-8") as fh:
        json.dump(header, fh, indent=2)

    size_mb = out_width * out_height * 2 / 1_048_576
    print(
        f"\nWrote public/data/dem/sg-dem.bin — {out_width} x {out_height} "
        f"samples, {size_mb:.1f} MB"
    )
    print("Wrote public/data/dem/sg-dem.json")
    print("\nNext: python scripts/build_data.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch a terrain model for Singapore")
    parser.add_argument(
        "--zoom",
        type=int,
        default=12,
        help="Tile zoom. 12 is ~38 m/px and ~3.5 MB; 13 is ~19 m/px and 4x that.",
    )
    main(parser.parse_args().zoom)
