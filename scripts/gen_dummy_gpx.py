#!/usr/bin/env python3
"""Generate dummy GPX files for testing.

Writes synthetic-but-plausible tracks: loops, out-and-backs and zigzag hill
climbs with timestamps and an elevation profile that goes up, wiggles, and
comes down. Output goes to /tmp by default — generated fixtures never land
in the repo (AGENTS.md).

Usage:
    python3 scripts/gen_dummy_gpx.py                 # 3 files, one per shape, near Singapore
    python3 scripts/gen_dummy_gpx.py -n 10 --out /tmp/tracks
    python3 scripts/gen_dummy_gpx.py --lat 1.29 --lng 103.85 --seed 7
"""

import argparse
import math
import random
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape

# Rough metres-per-degree at the equator; fine for fake data anywhere.
M_DEG = 111_320


def ring(n: int, rng: random.Random) -> list[tuple[float, float]]:
    """A wobbly closed circle, ~2 km across."""
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        r = 500 + 120 * math.sin(3 * t + rng.uniform(0, 2)) + rng.uniform(-40, 40)
        pts.append((r * math.cos(t), r * math.sin(t)))
    pts.append(pts[0])  # loop back to the start
    return pts


def out_and_back(n: int, rng: random.Random) -> list[tuple[float, float]]:
    """A line out with a wiggle, retraced on the way home."""
    half = max(2, n // 2)
    out = [(i * 45.0, 60 * math.sin(i / 3) + rng.uniform(-15, 15)) for i in range(half)]
    return out + out[::-1][: n - half]


def zigzag(n: int, rng: random.Random) -> list[tuple[float, float]]:
    """Switchback repeats: short legs alternately climbing a hill."""
    pts, x, y, direction = [], 0.0, 0.0, 1
    leg = max(1, n // 12)
    while len(pts) < n:
        for _ in range(leg):
            if len(pts) >= n:
                break
            pts.append((x, y))
            y += 18
            x += direction * rng.uniform(-4, 4)
        direction = -direction
        x += 60 * direction
    return pts


def hill_profile(n: int, base_ele: float, gain: float, rng: random.Random) -> list[float]:
    """Elevation that rises to a peak mid-route and returns, with GPS noise."""
    return [
        round(base_ele + gain * math.sin(math.pi * i / max(1, n - 1)) + rng.uniform(-1.5, 1.5), 1)
        for i in range(n)
    ]


SHAPES = {"loop": ring, "out-and-back": out_and_back, "zigzag": zigzag}
NAMES = {"loop": "Ridge Loop", "out-and-back": "Summit Out and Back", "zigzag": "Switchback Repeats"}


def to_gpx(name: str, xy: list[tuple[float, float]], eles: list[float], start: datetime, pace_s: float) -> str:
    trkpts = "\n".join(
        f'      <trkpt lat="{lat:.6f}" lon="{lng:.6f}"><ele>{ele}</ele>'
        f"<time>{(start + timedelta(seconds=int(i * pace_s))).isoformat()}</time></trkpt>"
        for i, ((lng, lat), ele) in enumerate(zip(xy, eles))
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="hillgpx-gen-dummy" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>{escape(name)}</name><time>{start.isoformat()}</time></metadata>
  <trk><name>{escape(name)}</name><trkseg>
{trkpts}
  </trkseg></trk>
</gpx>
"""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-n", "--count", type=int, default=3, help="files to write (cycles the shapes)")
    ap.add_argument("--out", default="dummy_gpx", help="output directory (default dummy_gpx/, gitignored)")
    ap.add_argument("--lat", type=float, default=1.2903, help="centre latitude (default Southern Ridges, SG)")
    ap.add_argument("--lng", type=float, default=103.8020, help="centre longitude")
    ap.add_argument("--gain", type=float, default=140, help="metres of elevation gain to fake")
    ap.add_argument("--points", type=int, default=400, help="trackpoints per file")
    ap.add_argument("--seed", type=int, default=None, help="reproducible output")
    ap.add_argument("--no-ele", action="store_true", help="omit <ele> (exercises terrain-fill paths)")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    shapes = list(SHAPES)

    for i in range(args.count):
        shape = shapes[i % len(shapes)]
        # A little jitter so files at the same centre do not overlap exactly.
        lat0 = args.lat + rng.uniform(-0.01, 0.01)
        lng0 = args.lng + rng.uniform(-0.01, 0.01)
        cos_lat = math.cos(math.radians(lat0))
        xy = [(lng0 + x / (M_DEG * cos_lat), lat0 + y / M_DEG) for x, y in SHAPES[shape](args.points, rng)]
        name = f"Dummy {NAMES[shape]} {i + 1:02d}"
        eles = hill_profile(len(xy), 30 + rng.uniform(0, 20), args.gain, rng)
        gpx = to_gpx(name, xy, eles, datetime(2026, 10, 1, 7, 0, tzinfo=timezone.utc), 10.0)
        if args.no_ele:
            gpx = re.sub(r"<ele>[\d.]+</ele>", "", gpx)
        path = out_dir / f"{name.lower().replace(' ', '-')}.gpx"
        path.write_text(gpx)
        dist = sum(math.hypot(xy[j][0] - xy[j - 1][0], xy[j][1] - xy[j - 1][1]) for j in range(1, len(xy)))
        print(f"{path}  ({shape}, {len(xy)} pts, ~{dist * M_DEG / 1000:.1f} km, {'no ele' if args.no_ele else f'{max(eles) - min(eles):.0f} m up'})")


if __name__ == "__main__":
    main()
