#!/usr/bin/env python3
"""
Build the app's static datasets.

Reads the curated venue files and every GPX under data/routes/, then writes
public/data/venues.json and public/data/routes.json — the only two files the
web app loads. Run it after changing anything under data/.

    python scripts/build_data.py

This is the step that makes a route contribution a one-file pull request: drop
a .gpx into data/routes/, run this, commit the result. Distance and elevation
gain are computed here rather than trusted from the file.

Dependencies: none beyond the standard library. If a terrain model has been
fetched (scripts/fetch_dem.py), elevations are re-sampled from it; otherwise the
GPX's own altitudes are used and the output is flagged accordingly.
"""

from __future__ import annotations

import array
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Iterable

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.join(SCRIPT_DIR, "..")
VENUE_DIR = os.path.join(REPO_ROOT, "data", "venues")
ROUTE_DIR = os.path.join(REPO_ROOT, "data", "routes")
OUT_DIR = os.path.join(REPO_ROOT, "public", "data")
DEM_DIR = os.path.join(OUT_DIR, "dem")

# A venue is considered "on" a route if the track passes within this distance.
VENUE_LINK_RADIUS_M = 150.0

# Ignore rises smaller than this when accumulating gain. Mirrors the default in
# src/lib/elevation.ts — keep the two in step or the app will disagree with the
# numbers baked into routes.json.
GAIN_THRESHOLD_M = 2.0
SMOOTH_WINDOW = 5

GPX_NS = {"gpx": "http://www.topografix.com/GPX/1/1"}


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


def haversine_m(a_lng: float, a_lat: float, b_lng: float, b_lat: float) -> float:
    r = 6371008.8
    d_lat = math.radians(b_lat - a_lat)
    d_lng = math.radians(b_lng - a_lng)
    s = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lng / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(s))


def smooth(values: list[float], window: int) -> list[float]:
    if window <= 1 or len(values) < window:
        return values
    half = window // 2
    out = []
    for i in range(len(values)):
        lo = max(0, i - half)
        hi = min(len(values) - 1, i + half)
        out.append(sum(values[lo : hi + 1]) / (hi - lo + 1))
    return out


def compute_gain(elevations: list[float]) -> tuple[float, float]:
    """Cumulative gain and loss, ignoring runs below the noise threshold."""
    if len(elevations) < 2:
        return 0.0, 0.0
    eles = smooth(elevations, SMOOTH_WINDOW)
    gain = loss = 0.0
    anchor = eles[0]
    for e in eles[1:]:
        delta = e - anchor
        if delta >= GAIN_THRESHOLD_M:
            gain += delta
            anchor = e
        elif delta <= -GAIN_THRESHOLD_M:
            loss += -delta
            anchor = e
    return gain, loss


def simplify(points: list[list[float]], tolerance: float = 1e-5) -> list[list[float]]:
    """Douglas-Peucker, so a watch export does not become megabytes of JSON."""
    if len(points) <= 2:
        return points

    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    sq_tol = tolerance * tolerance

    while stack:
        first, last = stack.pop()
        max_sq, index = 0.0, 0
        ax, ay = points[first][0], points[first][1]
        bx, by = points[last][0], points[last][1]
        for i in range(first + 1, last):
            sq = _sq_seg_dist(points[i][0], points[i][1], ax, ay, bx, by)
            if sq > max_sq:
                max_sq, index = sq, i
        if max_sq > sq_tol and index:
            keep[index] = True
            stack.append((first, index))
            stack.append((index, last))

    return [p for p, k in zip(points, keep) if k]


def _sq_seg_dist(px, py, ax, ay, bx, by) -> float:
    x, y = ax, ay
    dx, dy = bx - x, by - y
    if dx or dy:
        t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy)
        if t > 1:
            x, y = bx, by
        elif t > 0:
            x += dx * t
            y += dy * t
    dx, dy = px - x, py - y
    return dx * dx + dy * dy


# ---------------------------------------------------------------------------
# Terrain model
# ---------------------------------------------------------------------------


class Dem:
    """The bundled elevation grid, if one has been fetched."""

    def __init__(self, header: dict, grid: array.array) -> None:
        self.h = header
        self.grid = grid

    @classmethod
    def load(cls) -> "Dem | None":
        header_path = os.path.join(DEM_DIR, "sg-dem.json")
        grid_path = os.path.join(DEM_DIR, "sg-dem.bin")
        if not (os.path.exists(header_path) and os.path.exists(grid_path)):
            return None

        with open(header_path, encoding="utf-8") as fh:
            header = json.load(fh)
        grid = array.array("h")
        with open(grid_path, "rb") as fh:
            grid.frombytes(fh.read())
        if sys.byteorder == "big":
            grid.byteswap()

        expected = header["width"] * header["height"]
        if len(grid) != expected:
            print(f"  Warning: DEM size mismatch ({len(grid)} vs {expected}); ignoring it")
            return None
        return cls(header, grid)

    def sample(self, lng: float, lat: float) -> float | None:
        h = self.h
        if not (h["west"] <= lng <= h["east"] and h["south"] <= lat <= h["north"]):
            return None
        col = round((lng - h["west"]) / (h["east"] - h["west"]) * (h["width"] - 1))
        row = round((h["north"] - lat) / (h["north"] - h["south"]) * (h["height"] - 1))
        value = self.grid[row * h["width"] + col]
        return None if value == h["noData"] else float(value)


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def slugify(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")


def load_venues() -> list[dict]:
    """Curated venues first, then generated HDB blocks if they have been built."""
    venues: list[dict] = []

    hills_path = os.path.join(VENUE_DIR, "hills.json")
    with open(hills_path, encoding="utf-8") as fh:
        for v in json.load(fh)["venues"]:
            venues.append({**v, "id": v["slug"], "routeSlugs": []})
    print(f"  {len(venues)} curated venues")

    hdb_path = os.path.join(VENUE_DIR, "hdb-blocks.json")
    if os.path.exists(hdb_path):
        with open(hdb_path, encoding="utf-8") as fh:
            blocks = json.load(fh)["venues"]
        for v in blocks:
            venues.append({**v, "id": v["slug"], "routeSlugs": []})
        print(f"  {len(blocks):,} HDB blocks")
    else:
        print("  No HDB blocks yet — run scripts/ingest_hdb.py to add them")

    return venues


def parse_gpx_file(path: str) -> tuple[str | None, list[list[float]]]:
    tree = ET.parse(path)
    root = tree.getroot()

    def find_points(tag: str) -> list[ET.Element]:
        # Handle both namespaced and bare GPX, which both occur in the wild.
        nodes = root.findall(f".//gpx:{tag}", GPX_NS)
        return nodes if nodes else root.findall(f".//{tag}")

    nodes = find_points("trkpt") or find_points("rtept")

    points: list[list[float]] = []
    for node in nodes:
        try:
            lat = float(node.attrib["lat"])
            lng = float(node.attrib["lon"])
        except (KeyError, ValueError):
            continue
        ele_node = node.find("gpx:ele", GPX_NS)
        if ele_node is None:
            ele_node = node.find("ele")
        try:
            ele = float(ele_node.text) if ele_node is not None and ele_node.text else 0.0
        except ValueError:
            ele = 0.0
        points.append([lng, lat, ele])

    name_node = root.find(".//gpx:trk/gpx:name", GPX_NS) or root.find(".//trk/name")
    name = name_node.text.strip() if name_node is not None and name_node.text else None
    return name, points


def load_sidecar(gpx_path: str) -> dict:
    """Optional metadata next to a GPX: same basename, .json extension."""
    sidecar = os.path.splitext(gpx_path)[0] + ".json"
    if not os.path.exists(sidecar):
        return {}
    with open(sidecar, encoding="utf-8") as fh:
        return json.load(fh)


def link_venues(points: Iterable[list[float]], venues: list[dict]) -> list[str]:
    """
    Venues the track passes near, in the order it first reaches them.

    Auto-linking by proximity means a contributor does not have to know venue
    slugs to add a route; a sidecar file can still override it when the guess is
    wrong (a track that merely passes a hill on the road, say).
    """
    found: list[tuple[int, str]] = []
    seen: set[str] = set()
    pts = list(points)

    for venue in venues:
        # HDB blocks are dense enough that proximity linking would attach dozens
        # of them to any urban route; they must be named explicitly in a sidecar.
        if venue["type"] == "hdb_block":
            continue
        for index, (lng, lat, _) in enumerate(pts):
            if haversine_m(lng, lat, venue["lng"], venue["lat"]) <= VENUE_LINK_RADIUS_M:
                if venue["slug"] not in seen:
                    seen.add(venue["slug"])
                    found.append((index, venue["slug"]))
                break

    return [slug for _, slug in sorted(found)]


def build_routes(venues: list[dict], dem: Dem | None) -> list[dict]:
    if not os.path.isdir(ROUTE_DIR):
        return []

    routes: list[dict] = []
    files = sorted(f for f in os.listdir(ROUTE_DIR) if f.lower().endswith(".gpx"))

    for filename in files:
        path = os.path.join(ROUTE_DIR, filename)
        try:
            gpx_name, points = parse_gpx_file(path)
        except ET.ParseError as exc:
            print(f"  SKIP {filename}: not valid XML ({exc})")
            continue

        if len(points) < 2:
            print(f"  SKIP {filename}: fewer than two track points")
            continue

        meta = load_sidecar(path)
        points = simplify(points)

        # Never trust GPX altitude when a terrain model is available.
        resampled = False
        if dem:
            for p in points:
                sampled = dem.sample(p[0], p[1])
                if sampled is not None:
                    p[2] = sampled
                    resampled = True

        distance = sum(
            haversine_m(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
            for i in range(1, len(points))
        )
        gain, loss = compute_gain([p[2] for p in points])

        slug = meta.get("slug") or slugify(os.path.splitext(filename)[0])
        name = meta.get("name") or gpx_name or slug.replace("-", " ").title()
        venue_slugs = meta.get("venues") or link_venues(points, venues)

        start, end = points[0], points[-1]
        is_loop = haversine_m(start[0], start[1], end[0], end[1]) < 100

        routes.append({
            "id": slug,
            "slug": slug,
            "name": name,
            "venueSlugs": venue_slugs,
            "distanceM": round(distance, 1),
            "gainM": round(gain, 1),
            "lossM": round(loss, 1),
            "loop": is_loop,
            "surface": meta.get("surface"),
            "difficulty": meta.get("difficulty"),
            "coordinates": [[round(p[0], 6), round(p[1], 6), round(p[2], 1)] for p in points],
            "source": meta.get("source", "community"),
            "contributor": meta.get("contributor"),
            "description": meta.get("description"),
        })

        flag = "" if resampled else "  (no terrain model — gain from GPX altitude)"
        print(
            f"  {filename}: {len(points)} pts, {distance / 1000:.2f} km, "
            f"{gain:.0f} m up, venues={venue_slugs or '[]'}{flag}"
        )

    return routes


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    print("Building static datasets\n")

    dem = Dem.load()
    print(
        "  Terrain model: loaded"
        if dem
        else "  Terrain model: not found (run scripts/fetch_dem.py for accurate gain)"
    )

    print("\nVenues")
    venues = load_venues()

    print("\nRoutes")
    routes = build_routes(venues, dem)
    if not routes:
        print("  No GPX files in data/routes/ yet")

    # Back-link routes onto their venues so the app can render a venue's route
    # list without scanning every route.
    by_slug = {v["slug"]: v for v in venues}
    for route in routes:
        for venue_slug in route["venueSlugs"]:
            venue = by_slug.get(venue_slug)
            if venue is None:
                print(f"  Warning: route {route['slug']} references unknown venue {venue_slug}")
                continue
            venue["routeSlugs"].append(route["slug"])

    os.makedirs(OUT_DIR, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat()

    with open(os.path.join(OUT_DIR, "venues.json"), "w", encoding="utf-8") as fh:
        json.dump({"generatedAt": generated_at, "venues": venues}, fh, separators=(",", ":"))
    with open(os.path.join(OUT_DIR, "routes.json"), "w", encoding="utf-8") as fh:
        json.dump({"generatedAt": generated_at, "routes": routes}, fh, separators=(",", ":"))

    venues_kb = os.path.getsize(os.path.join(OUT_DIR, "venues.json")) / 1024
    routes_kb = os.path.getsize(os.path.join(OUT_DIR, "routes.json")) / 1024

    print(
        f"\nWrote public/data/venues.json ({len(venues):,} venues, {venues_kb:.0f} KB)"
        f"\nWrote public/data/routes.json ({len(routes):,} routes, {routes_kb:.0f} KB)"
    )


if __name__ == "__main__":
    main()
