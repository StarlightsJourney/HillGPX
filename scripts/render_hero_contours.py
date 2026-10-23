#!/usr/bin/env python3
"""
Draw the landing hero's background: the real terrain around Bukit Timah Hill
as a topographic map, from the Singapore terrain model the app already ships.

    python3 scripts/render_hero_contours.py

Reads  public/data/dem/sg-dem.json + sg-dem.bin (see fetch_dem.py)
Writes public/hero/bukit-timah-tint.png       height tints (pale green low,
                                              sand and tan on the summits)
       public/hero/bukit-timah-contours.json  contour lines over them: the
                                              hero draws each one itself, so
                                              it can trace them in and run a
                                              current along them

Standard library only. The model is ~38 m a cell, so the grid is upsampled
before tracing (marching squares) and each line is smoothed (Chaikin) and
thinned (Ramer-Douglas-Peucker) to keep the file small and the curves soft.
Lines are every 10 m; every fifth is an index contour, drawn a little heavier, as on a printed
topographic map. Each line carries its length, which the page needs to
trace it in.
"""

from __future__ import annotations

import array
import json
import math
import os
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEM_JSON = os.path.join(ROOT, "public", "data", "dem", "sg-dem.json")
DEM_BIN = os.path.join(ROOT, "public", "data", "dem", "sg-dem.bin")
OUT = os.path.join(ROOT, "public", "hero", "bukit-timah-contours.json")
TINT_OUT = os.path.join(ROOT, "public", "hero", "bukit-timah-tint.png")

# Bukit Timah Hill (163 m) a little right of centre, with Bukit Gombak and
# Dairy Farm to its west. Roughly 2:1, the shape of the hero on a laptop.
WEST, EAST = 103.722, 103.818
SOUTH, NORTH = 1.326, 1.376
INTERVAL_M = 10
INDEX_EVERY = 5
UPSAMPLE = 4
OUT_WIDTH = 1600  # SVG units across; height follows the box's true aspect
MIN_LENGTH = 140  # SVG units; shorter lines are dropped

# Height tints in the family of the site's own map (the route cards): pale
# greens on low ground, then olive, sand and tan towards the summits. Stepped
# bands, not a smooth ramp, as on a printed physical map. (upper bound m, RGB)
TINTS = [
    (20, (233, 241, 223)),
    (40, (220, 235, 207)),
    (60, (207, 227, 192)),
    (80, (223, 229, 191)),
    (100, (235, 229, 194)),
    (130, (239, 220, 182)),
    (160, (233, 202, 160)),
    (math.inf, (226, 185, 143)),
]


def load_dem() -> tuple[dict, array.array]:
    with open(DEM_JSON) as f:
        header = json.load(f)
    data = array.array("h")
    with open(DEM_BIN, "rb") as f:
        data.frombytes(f.read())
    if sys.byteorder != "little":
        data.byteswap()
    return header, data


def crop(header: dict, data: array.array) -> list[list[float]]:
    """The box as rows of metres, north to south, sea and gaps as 0."""
    w, h = header["width"], header["height"]
    dx = (header["east"] - header["west"]) / w
    dy = (header["north"] - header["south"]) / h
    c0 = int((WEST - header["west"]) / dx)
    c1 = int(math.ceil((EAST - header["west"]) / dx))
    r0 = int((header["north"] - NORTH) / dy)
    r1 = int(math.ceil((header["north"] - SOUTH) / dy))
    rows = []
    for r in range(r0, r1 + 1):
        row = []
        for c in range(c0, c1 + 1):
            v = data[r * w + c]
            row.append(0.0 if v == header["noData"] else float(max(v, 0)))
        rows.append(row)
    return rows


def despike(grid: list[list[float]], limit: float = 40) -> list[list[float]]:
    """
    Replace cells far above every neighbour with their neighbours' median.
    The model has a few bad cells near Upper Peirce (~480 m on ~100 m ground)
    that would draw as a bullseye of rings.
    """
    h, w = len(grid), len(grid[0])
    out = [row[:] for row in grid]
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            around = sorted(grid[yy][xx] for yy in (y - 1, y, y + 1) for xx in (x - 1, x, x + 1) if (yy, xx) != (y, x))
            if grid[y][x] - around[-1] > limit or grid[y][x] - around[4] > limit * 2:
                out[y][x] = around[4]
    return out


def upsample(grid: list[list[float]], k: int) -> list[list[float]]:
    """Bilinear, so traced lines bend instead of stepping cell by cell."""
    h, w = len(grid), len(grid[0])
    out = []
    for y in range((h - 1) * k + 1):
        fy = y / k
        y0 = min(int(fy), h - 2)
        ty = fy - y0
        row = []
        for x in range((w - 1) * k + 1):
            fx = x / k
            x0 = min(int(fx), w - 2)
            tx = fx - x0
            a, b = grid[y0][x0], grid[y0][x0 + 1]
            c, d = grid[y0 + 1][x0], grid[y0 + 1][x0 + 1]
            row.append((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty)
        out.append(row)
    return out


def blur(grid: list[list[float]], passes: int = 4) -> list[list[float]]:
    """A light 3x3 box blur: takes the SRTM speckle out of flat ground."""
    h, w = len(grid), len(grid[0])
    for _ in range(passes):
        nxt = [row[:] for row in grid]
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                s = 0.0
                for yy in (y - 1, y, y + 1):
                    r = grid[yy]
                    s += r[x - 1] + r[x] + r[x + 1]
                nxt[y][x] = s / 9
        grid = nxt
    return grid


def march(grid: list[list[float]], level: float) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Marching squares: one or two segments per cell the level crosses."""
    segs = []
    h, w = len(grid), len(grid[0])

    def lerp(p, q, vp, vq):
        t = (level - vp) / (vq - vp)
        return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)

    for y in range(h - 1):
        r0, r1 = grid[y], grid[y + 1]
        for x in range(w - 1):
            tl, tr, br, bl = r0[x], r0[x + 1], r1[x + 1], r1[x]
            idx = (tl >= level) << 3 | (tr >= level) << 2 | (br >= level) << 1 | (bl >= level)
            if idx in (0, 15):
                continue
            top = lambda: lerp((x, y), (x + 1, y), tl, tr)
            right = lambda: lerp((x + 1, y), (x + 1, y + 1), tr, br)
            bottom = lambda: lerp((x, y + 1), (x + 1, y + 1), bl, br)
            left = lambda: lerp((x, y), (x, y + 1), tl, bl)
            if idx in (1, 14):
                segs.append((left(), bottom()))
            elif idx in (2, 13):
                segs.append((bottom(), right()))
            elif idx in (3, 12):
                segs.append((left(), right()))
            elif idx in (4, 11):
                segs.append((top(), right()))
            elif idx in (6, 9):
                segs.append((top(), bottom()))
            elif idx in (7, 8):
                segs.append((left(), top()))
            elif idx == 5:
                segs.append((left(), top()))
                segs.append((bottom(), right()))
            elif idx == 10:
                segs.append((top(), right()))
                segs.append((left(), bottom()))
    return segs


def join(segs) -> list[list[tuple[float, float]]]:
    """Chain segments that share an end point into polylines."""
    key = lambda p: (round(p[0], 4), round(p[1], 4))
    ends: dict[tuple, list[int]] = {}
    for i, (a, b) in enumerate(segs):
        ends.setdefault(key(a), []).append(i)
        ends.setdefault(key(b), []).append(i)
    used = [False] * len(segs)
    lines = []
    for i in range(len(segs)):
        if used[i]:
            continue
        used[i] = True
        line = [segs[i][0], segs[i][1]]
        for forward in (True, False):
            while True:
                tip = line[-1] if forward else line[0]
                nxt = next((j for j in ends.get(key(tip), []) if not used[j]), None)
                if nxt is None:
                    break
                used[nxt] = True
                a, b = segs[nxt]
                other = b if key(a) == key(tip) else a
                if forward:
                    line.append(other)
                else:
                    line.insert(0, other)
        lines.append(line)
    return lines


def chaikin(line, passes: int = 2):
    closed = line[0] == line[-1]
    for _ in range(passes):
        out = [] if closed else [line[0]]
        for p, q in zip(line, line[1:]):
            out.append((0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]))
            out.append((0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]))
        if closed:
            out.append(out[0])
        else:
            out.append(line[-1])
        line = out
    return line


def rdp(line, eps: float):
    if len(line) < 3:
        return line
    if line[0] == line[-1]:
        # A closed ring has no chord to measure against: split it at its
        # far side and simplify the two halves.
        mid = max(range(len(line)), key=lambda i: math.hypot(line[i][0] - line[0][0], line[i][1] - line[0][1]))
        return rdp(line[: mid + 1], eps)[:-1] + rdp(line[mid:], eps)
    (x1, y1), (x2, y2) = line[0], line[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-9
    far, idx = -1.0, 0
    for i in range(1, len(line) - 1):
        x0, y0 = line[i]
        d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm
        if d > far:
            far, idx = d, i
    if far <= eps:
        return [line[0], line[-1]]
    return rdp(line[: idx + 1], eps)[:-1] + rdp(line[idx:], eps)


def tint(metres: float) -> tuple[int, int, int]:
    return next(rgb for top, rgb in TINTS if metres < top)


def write_png(path: str, rows: list[list[tuple[int, int, int]]]) -> None:
    """A plain 8-bit RGB PNG; flat bands compress to a few tens of KB."""
    h, w = len(rows), len(rows[0])
    raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def main() -> None:
    header, data = load_dem()
    grid = blur(upsample(despike(despike(crop(header, data))), UPSAMPLE))
    h, w = len(grid), len(grid[0])
    # True aspect: a degree of longitude is cos(lat) of a degree of latitude.
    aspect = ((NORTH - SOUTH) / ((EAST - WEST) * math.cos(math.radians((NORTH + SOUTH) / 2))))
    out_h = round(OUT_WIDTH * aspect)
    sx, sy = OUT_WIDTH / (w - 1), out_h / (h - 1)
    top = max(max(row) for row in grid)

    lines = []
    level = INTERVAL_M
    while level < top:
        for line in join(march(grid, level)):
            pts = [(x * sx, y * sy) for x, y in line]
            # Specks and short scraps read as noise, not terrain.
            if sum(math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in zip(pts, pts[1:])) < MIN_LENGTH:
                continue
            pts = [(round(x), round(y)) for x, y in rdp(chaikin(pts), 0.8)]
            lines.append({
                "d": "M" + "L".join(f"{x} {y}" for x, y in pts),
                "index": (level // INTERVAL_M) % INDEX_EVERY == 0,
                "length": round(sum(math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in zip(pts, pts[1:]))),
            })
        level += INTERVAL_M

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(
            {
                "attribution": f"Contours every {INTERVAL_M} m around Bukit Timah Hill, Singapore. "
                "Elevation: AWS Open Data terrain tiles (Terrarium), derived from SRTM.",
                "width": OUT_WIDTH,
                "height": out_h,
                "lines": lines,
            },
            f,
            separators=(",", ":"),
        )
    size = os.path.getsize(OUT)
    print(f"Wrote {os.path.relpath(OUT, ROOT)} ({len(lines)} lines, top {top:.0f} m, {size // 1024} KB)")

    # Same grid, same box: the tints sit exactly under the lines.
    write_png(TINT_OUT, [[tint(v) for v in row] for row in grid])
    print(f"Wrote {os.path.relpath(TINT_OUT, ROOT)} ({w} x {h}, {os.path.getsize(TINT_OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
