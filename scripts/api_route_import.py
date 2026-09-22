#!/usr/bin/env python3
"""
Import a route by calling the platform's own backend API.

    python3 scripts/api_route_import.py "https://www.strava.com/routes/12345" \
        --headers headers.json --name "Route name" --build

Why this instead of scraping:
* The app should not pretend to be a browser.
* Backend APIs return clean JSON/GPX and are far less fragile than HTML parsing.
* You supply the exact session the platform already trusts — Cookie and/or
  Authorization token copied from your own browser.

What you need:
1. Open the route/activity page in a browser.
2. Open DevTools (F12) → Network tab.
3. Reload the page and find the API call that returns track data.
   Common patterns:
     Strava route:     GET /api/v3/routes/{id}/export_gpx
     Strava activity:  GET /api/v3/activities/{id}/streams?keys=latlng,altitude
     Strava route stream: GET /api/v3/routes/{id}/streams
     Komoot tour:      GET /api/v07/tours/{id}.gpx
     Wikiloc:          POST /wikiloc/retina.do?act=download_gpx&id={id}
4. Right-click that request → Copy → Copy as cURL (bash). Extract the
   Cookie and/or Authorization header and save them as JSON:

   {
     "Authorization": "Bearer abc123",
     "User-Agent": "Mozilla/5.0 ..."
   }

   or for Cookie-based sites:

   {
     "Cookie": "sessionid=...; csrftoken=...",
     "User-Agent": "Mozilla/5.0 ..."
   }

Only import routes you have permission to republish. Strava, Komoot and Wikiloc
terms restrict redistribution; use this for routes you recorded or have explicit
permission to share.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import gpxpy
import gpxpy.gpx
import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
ROUTE_DIR = REPO_ROOT / "data" / "routes"
ROUTES_JSON = REPO_ROOT / "public" / "data" / "routes.json"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

Point = tuple[float, float, float | None]


# ---------------------------------------------------------------------------
# HTTP client with retries
# ---------------------------------------------------------------------------


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.NetworkError, httpx.TimeoutException)),
    reraise=True,
)
def http_get(url: str, headers: dict[str, str], *, timeout: int = 60, follow_redirects: bool = True) -> httpx.Response:
    with httpx.Client(timeout=timeout, follow_redirects=follow_redirects) as client:
        response = client.get(url, headers=headers)
        response.raise_for_status()
        return response


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.NetworkError, httpx.TimeoutException)),
    reraise=True,
)
def http_post(url: str, headers: dict[str, str], data: dict[str, Any] | None = None, *, timeout: int = 60) -> httpx.Response:
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        response = client.post(url, headers=headers, data=data)
        response.raise_for_status()
        return response


# ---------------------------------------------------------------------------
# URL / ID parsing
# ---------------------------------------------------------------------------


def parse_strava_id(url: str) -> tuple[str, str] | None:
    """Return (kind, id) for routes or activities."""
    for pattern, kind in (
        (r"strava\.com/routes/(\d+)", "route"),
        (r"strava\.com/activities/(\d+)", "activity"),
    ):
        match = re.search(pattern, url)
        if match:
            return kind, match.group(1)
    return None


def parse_komoot_id(url: str) -> str | None:
    match = re.search(r"komoot\.(?:com|de|fr|es|it|nl)/tour/(\d+)", url)
    return match.group(1) if match else None


def parse_wikiloc_id(url: str) -> str | None:
    match = re.search(r"wikiloc\.com/.+-(\d+)", url)
    if match:
        return match.group(1)
    match = re.search(r"wikiloc\.com.*id=(\d+)", url)
    return match.group(1) if match else None


# ---------------------------------------------------------------------------
# GPX helpers
# ---------------------------------------------------------------------------


def build_gpx(name: str, points: list[Point]) -> str:
    gpx = gpxpy.gpx.GPX()
    gpx.creator = "HillGPX api_route_import.py"
    gpx_track = gpxpy.gpx.GPXTrack()
    gpx_track.name = name
    gpx.tracks.append(gpx_track)
    segment = gpxpy.gpx.GPXTrackSegment()
    gpx_track.segments.append(segment)
    for lon, lat, ele in points:
        pt = gpxpy.gpx.GPXTrackPoint(latitude=lat, longitude=lon)
        if ele is not None:
            pt.elevation = ele
        segment.points.append(pt)
    return gpx.to_xml()


def load_headers(path: str | None) -> dict[str, str]:
    headers: dict[str, str] = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if not path:
        return headers
    with open(path, encoding="utf-8") as fh:
        extra = json.load(fh)
    if not isinstance(extra, dict):
        sys.exit("Headers file must be a JSON object")
    headers.update({str(k): str(v) for k, v in extra.items()})
    return headers


def load_cookies(path: str | None) -> dict[str, str]:
    if not path:
        return {}
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, dict):
        return {str(k): str(v) for k, v in data.items()}
    if isinstance(data, list):
        return {item["name"]: item["value"] for item in data if "name" in item and "value" in item}
    sys.exit("Cookies file must be a JSON object or a list of {name, value}")


def merge_cookie_header(headers: dict[str, str], cookies: dict[str, str]) -> dict[str, str]:
    if not cookies:
        return headers
    parts = [f"{k}={v}" for k, v in cookies.items()]
    existing = headers.get("Cookie", "")
    headers["Cookie"] = "; ".join(filter(None, [existing, "; ".join(parts)]))
    return headers


# ---------------------------------------------------------------------------
# Platform adapters
# ---------------------------------------------------------------------------


def strava_route_export(route_id: str, headers: dict[str, str]) -> list[Point]:
    url = f"https://www.strava.com/api/v3/routes/{route_id}/export_gpx"
    print(f"Requesting {url}")
    response = http_get(url, headers)
    gpx = gpxpy.parse(response.text)
    points = []
    for track in gpx.tracks:
        for segment in track.segments:
            for pt in segment.points:
                points.append((pt.longitude, pt.latitude, pt.elevation))
    if not points:
        raise ValueError("Strava returned an empty GPX")
    return points


def strava_streams(stream_id: str, kind: str, headers: dict[str, str]) -> list[Point]:
    """Fetch latlng + altitude streams for a route or activity."""
    url = f"https://www.strava.com/api/v3/{kind}s/{stream_id}/streams?keys=latlng,altitude&key_by_type=true"
    print(f"Requesting {url}")
    response = http_get(url, headers)
    body = response.json()
    if not isinstance(body, dict):
        raise ValueError("Unexpected Strava stream response")
    latlng = body.get("latlng")
    altitude = body.get("altitude")
    if not isinstance(latlng, list) or len(latlng) < 2:
        raise ValueError("Strava stream did not contain latlng data")
    points: list[Point] = []
    for i, pair in enumerate(latlng):
        if not isinstance(pair, (list, tuple)) or len(pair) < 2:
            continue
        lat, lon = float(pair[0]), float(pair[1])
        ele = None
        if isinstance(altitude, list) and i < len(altitude):
            val = altitude[i]
            if isinstance(val, (int, float)):
                ele = float(val)
        points.append((lon, lat, ele))
    if len(points) < 2:
        raise ValueError("Strava stream contained no usable points")
    return points


def komoot_tour(tour_id: str, headers: dict[str, str]) -> list[Point]:
    """Try Komoot's public .gpx endpoints; newer tours may require cookies."""
    for prefix in ("v07", "v007"):
        url = f"https://www.komoot.com/api/{prefix}/tours/{tour_id}.gpx"
        print(f"Trying {url}")
        try:
            response = http_get(url, headers)
            gpx = gpxpy.parse(response.text)
            points = []
            for track in gpx.tracks:
                for segment in track.segments:
                    for pt in segment.points:
                        points.append((pt.longitude, pt.latitude, pt.elevation))
            if points:
                return points
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                continue
            raise
    raise ValueError("Could not fetch Komoot tour as GPX")


def wikiloc_gpx(trail_id: str, headers: dict[str, str]) -> list[Point]:
    """Best-effort Wikiloc GPX download. May require a logged-in session."""
    url = f"https://www.wikiloc.com/wikiloc/retina.do?act=download_gpx&id={trail_id}"
    print(f"Requesting {url}")
    response = http_post(url, headers)
    text = response.text
    try:
        gpx = gpxpy.parse(text)
    except gpxpy.gpx.GPXXMLParseException as exc:
        raise ValueError(f"Wikiloc response was not a GPX file: {exc}") from exc
    points = []
    for track in gpx.tracks:
        for segment in track.segments:
            for pt in segment.points:
                points.append((pt.longitude, pt.latitude, pt.elevation))
    if not points:
        raise ValueError("Wikiloc returned an empty GPX")
    return points


def generic_json(url: str, json_path: str | None, headers: dict[str, str]) -> list[Point]:
    print(f"Fetching {url}")
    response = http_get(url, headers)
    data = response.json()
    points = extract_by_path(data, json_path) if json_path else extract_coordinates(data)
    if not points:
        raise ValueError("Could not find coordinate arrays in the JSON response")
    return points


def generic_gpx(url: str, headers: dict[str, str]) -> list[Point]:
    print(f"Fetching {url}")
    response = http_get(url, headers)
    gpx = gpxpy.parse(response.text)
    points = []
    for track in gpx.tracks:
        for segment in track.segments:
            for pt in segment.points:
                points.append((pt.longitude, pt.latitude, pt.elevation))
    if not points:
        raise ValueError("GPX response contained no track points")
    return points


# ---------------------------------------------------------------------------
# Generic JSON coordinate extraction
# ---------------------------------------------------------------------------


def is_lng(x: Any) -> bool:
    return isinstance(x, (int, float)) and -180 <= float(x) <= 180


def is_lat(y: Any) -> bool:
    return isinstance(y, (int, float)) and -90 <= float(y) <= 90


def extract_coordinates(value: Any) -> list[Point] | None:
    """Best-effort recursive extraction of coordinate arrays from JSON."""
    if isinstance(value, dict):
        coords = value.get("coordinates")
        if isinstance(coords, list) and coords:
            pts: list[Point] = []
            for c in coords:
                if isinstance(c, (list, tuple)) and len(c) >= 2 and is_lng(c[0]) and is_lat(c[1]):
                    ele = float(c[2]) if len(c) >= 3 and isinstance(c[2], (int, float)) else None
                    pts.append((float(c[0]), float(c[1]), ele))
            if len(pts) >= 2:
                return pts
        for key in ("latlng", "polyline", "trackPoints", "points", "locations"):
            if key in value:
                pts = extract_coordinates(value[key])
                if pts:
                    return pts
        for v in value.values():
            pts = extract_coordinates(v)
            if pts:
                return pts
        return None

    if isinstance(value, list):
        if not value:
            return None
        first = value[0]
        if isinstance(first, (list, tuple)) and len(first) >= 2 and is_lng(first[0]) and is_lat(first[1]):
            pts = []
            for item in value:
                if isinstance(item, (list, tuple)) and len(item) >= 2 and is_lng(item[0]) and is_lat(item[1]):
                    ele = float(item[2]) if len(item) >= 3 and isinstance(item[2], (int, float)) else None
                    pts.append((float(item[0]), float(item[1]), ele))
            if len(pts) >= 2:
                return pts
        if isinstance(first, dict) and looks_like_coordinate(first):
            pts = []
            for item in value:
                if not isinstance(item, dict):
                    continue
                lat = item.get("lat") or item.get("latitude") or item.get("y")
                lng = item.get("lon") or item.get("lng") or item.get("longitude") or item.get("x")
                if is_lat(lat) and is_lng(lng):
                    ele = item.get("ele") or item.get("elevation") or item.get("altitude") or item.get("alt")
                    ele_f = float(ele) if isinstance(ele, (int, float)) else None
                    pts.append((float(lng), float(lat), ele_f))
            if len(pts) >= 2:
                return pts
        for item in value[:200]:
            pts = extract_coordinates(item)
            if pts:
                return pts
        return None

    return None


def looks_like_coordinate(obj: dict[str, Any]) -> bool:
    if not isinstance(obj, dict):
        return False
    lat = obj.get("lat") or obj.get("latitude") or obj.get("y")
    lng = obj.get("lon") or obj.get("lng") or obj.get("longitude") or obj.get("x")
    return is_lat(lat) and is_lng(lng)


def extract_by_path(data: Any, path: str) -> list[Point]:
    keys = path.split(".")
    value = data
    for key in keys:
        if isinstance(value, dict):
            value = value.get(key)
        elif isinstance(value, list) and key.isdigit():
            value = value[int(key)]
        else:
            break
    pts = extract_coordinates(value)
    if not pts:
        raise ValueError(f"Could not extract coordinates from path {path!r}")
    return pts


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------


def haversine_m(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    r = 6_371_008.8
    d_lat = math.radians(b_lat - a_lat)
    d_lon = math.radians(b_lon - a_lon)
    s = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lon / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(s))


def route_length_m(points: list[Point]) -> float:
    return sum(
        haversine_m(points[i - 1][1], points[i - 1][0], points[i][1], points[i][0])
        for i in range(1, len(points))
    )


def load_existing_routes() -> list[dict[str, Any]]:
    routes: list[dict[str, Any]] = []
    seen: set[str] = set()

    if ROUTES_JSON.exists():
        try:
            with open(ROUTES_JSON, encoding="utf-8") as fh:
                data = json.load(fh)
            for route in data.get("routes", []) if isinstance(data, dict) else data:
                slug = str(route.get("slug", ""))
                if slug:
                    seen.add(slug)
                routes.append(route)
        except (json.JSONDecodeError, OSError):
            pass

    # Also check GPX files that may not have been rebuilt into routes.json yet.
    for gpx_path in ROUTE_DIR.glob("*.gpx"):
        slug = gpx_path.stem
        if slug in seen:
            continue
        try:
            gpx = gpxpy.parse(gpx_path.read_text(encoding="utf-8"))
            coords: list[list[float]] = []
            for track in gpx.tracks:
                for segment in track.segments:
                    for pt in segment.points:
                        coords.append([pt.longitude, pt.latitude, pt.elevation if pt.elevation is not None else 0.0])
            if len(coords) < 2:
                continue
            dist = sum(
                haversine_m(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0])
                for i in range(1, len(coords))
            )
            routes.append({"slug": slug, "coordinates": coords, "distanceM": dist})
            seen.add(slug)
        except Exception:
            continue

    return routes


def is_duplicate(points: list[Point], existing: list[dict[str, Any]]) -> str | None:
    """Return existing slug if the new route looks like a duplicate."""
    if len(points) < 2:
        return None
    start_lat, start_lon = points[0][1], points[0][0]
    end_lat, end_lon = points[-1][1], points[-1][0]
    new_length = route_length_m(points)

    for route in existing:
        coords = route.get("coordinates")
        if not isinstance(coords, list) or len(coords) < 2:
            continue
        ex_start = coords[0]
        ex_end = coords[-1]
        ex_length = route.get("distanceM", 0)
        # Match start or end within ~200 m and length within 10%.
        start_dist = haversine_m(start_lat, start_lon, ex_start[1], ex_start[0])
        end_dist = haversine_m(end_lat, end_lon, ex_end[1], ex_end[0])
        if (start_dist < 200 or end_dist < 200) and ex_length > 0 and abs(new_length - ex_length) / ex_length < 0.10:
            return str(route.get("slug", "unknown"))
    return None


# ---------------------------------------------------------------------------
# File output and integration
# ---------------------------------------------------------------------------


def slugify(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")


def save_route(
    name: str,
    points: list[Point],
    source_url: str,
    licence: str,
    contributor: str | None,
    force: bool = False,
) -> tuple[Path, bool]:
    base_slug = slugify(name) or "route"
    slug = base_slug
    counter = 1
    gpx_path = ROUTE_DIR / f"{slug}.gpx"
    while gpx_path.exists():
        slug = f"{base_slug}-{counter}"
        gpx_path = ROUTE_DIR / f"{slug}.gpx"
        counter += 1

    existing = load_existing_routes()
    duplicate_slug = is_duplicate(points, existing)
    if duplicate_slug and not force:
        print(f"WARNING: This route looks identical to {duplicate_slug}; skipping.")
        print("Pass --force to import it anyway.")
        return gpx_path, False

    gpx_xml = build_gpx(name, points)
    ROUTE_DIR.mkdir(parents=True, exist_ok=True)
    gpx_path.write_text(gpx_xml, encoding="utf-8")

    sidecar = ROUTE_DIR / f"{slug}.json"
    meta = {
        "name": name,
        "sourceUrl": source_url,
        "licence": licence,
        "contributor": contributor,
        "apiImport": True,
    }
    if duplicate_slug:
        meta["duplicateOf"] = duplicate_slug
        meta["note"] = "Imported despite looking like a duplicate; may be a variant or updated recording."

    sidecar.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved {gpx_path} ({len(points)} points, {route_length_m(points)/1000:.2f} km)")
    return gpx_path, True


def run_build() -> None:
    print("Running scripts/build_data.py")
    result = subprocess.run([sys.executable, "scripts/build_data.py"], cwd=REPO_ROOT)
    if result.returncode != 0:
        sys.exit(f"build_data.py failed with exit code {result.returncode}")
    print("Application dataset rebuilt")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def fetch_points(url: str, headers_path: str | None, cookies_path: str | None, json_path: str | None) -> list[Point]:
    headers = load_headers(headers_path)
    cookies = load_cookies(cookies_path)
    headers = merge_cookie_header(headers, cookies)

    parsed = parse_strava_id(url)
    if parsed:
        kind, route_id = parsed
        if kind == "route" and "Authorization" in headers:
            # Bearer token present: official export GPX endpoint.
            return strava_route_export(route_id, headers)
        return strava_streams(route_id, kind, headers)

    tour_id = parse_komoot_id(url)
    if tour_id:
        return komoot_tour(tour_id, headers)

    trail_id = parse_wikiloc_id(url)
    if trail_id:
        return wikiloc_gpx(trail_id, headers)

    # Generic: try JSON, then GPX.
    if json_path:
        return generic_json(url, json_path, headers)
    try:
        return generic_json(url, None, headers)
    except (httpx.HTTPStatusError, json.JSONDecodeError, ValueError):
        return generic_gpx(url, headers)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import a route by calling the platform's backend API with your own session headers/cookies."
    )
    parser.add_argument("url", help="Route or activity URL, or a direct API URL")
    parser.add_argument("--name", required=True, help="Display name for the route")
    parser.add_argument("--headers", help="JSON file with request headers (Authorization, User-Agent, ...)")
    parser.add_argument("--cookies", help="JSON file with cookies (object or list of {name, value})")
    parser.add_argument("--json-path", help="Dot-notation path to coordinates for generic JSON APIs, e.g. data.points")
    parser.add_argument("--licence", default="Check source site terms", help="Licence or permission note")
    parser.add_argument("--contributor", help="Your GitHub handle, e.g. @octocat")
    parser.add_argument("--build", action="store_true", help="Run scripts/build_data.py after importing")
    parser.add_argument("--force", action="store_true", help="Import even if the route looks like a duplicate")
    parser.add_argument("--timeout", type=int, default=60, help="Request timeout in seconds")
    return parser.parse_args(argv)


def main() -> int:
    args = parse_args()

    print("=" * 60)
    print("HillGPX API route importer")
    print("=" * 60)
    print("Legal: only import routes you have permission to republish.")
    print()

    try:
        points = fetch_points(args.url, args.headers, args.cookies, args.json_path)
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1

    print(f"Extracted {len(points)} track points")
    path, written = save_route(
        args.name,
        points,
        source_url=args.url,
        licence=args.licence,
        contributor=args.contributor,
        force=args.force,
    )
    if not written:
        return 0

    if args.build:
        run_build()

    print("\nDone.")
    print(f"  GPX:  {path.relative_to(REPO_ROOT)}")
    print(f"  Next: commit data/routes/ and public/data/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
