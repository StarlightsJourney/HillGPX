#!/usr/bin/env python3
"""
Scrape a GPX route from dynamic / authenticated sites using Playwright (async).

    python3 scripts/scrape_routes_playwright.py URL [URL ...]
        --name "Route name"
        --contributor @you
        --licence "Permission from author"
        --state state.json
        --headless
        --build

The script does NOT click download buttons. It launches a stealth Chromium,
loads any saved cookies/storage state, then listens to the page's background
network traffic. JSON/GeoJSON/GPX responses that contain route coordinates are
converted to a valid GPX file and saved to data/routes/. Finally it can rebuild
the public dataset so the route appears in the app.

Supported sources (best-effort, depends on the site not blocking you):

* Strava — uses the official API if STRAVA_ACCESS_TOKEN is set; otherwise falls
  back to intercepting the public route page.
* Komoot — tries the public /tours/{id}.gpx endpoint.
* Wikiloc / AllTrails — generic network interception; often requires an
  authenticated session saved with --save-state.
* Any other site that serves route coordinates as JSON/GeoJSON/GPX.

Only scrape routes you have permission to republish. Strava/AllTrails/Wikiloc
terms generally forbid scraping other people's routes without permission; this
tool is intended for routes you recorded or have explicit permission to share.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import random
import re
import subprocess
import sys
import tempfile
import urllib.error
from pathlib import Path
from typing import Any

# Re-use import_gpx.py's GPX parser/writer and provenance helpers.
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
ROUTE_DIR = REPO_ROOT / "data" / "routes"
OUT_DIR = REPO_ROOT / "gpx_downloads"

sys.path.insert(0, str(SCRIPT_DIR))
from import_gpx import (  # noqa: E402
    parse_gpx as import_parse_gpx,
    slugify,
    track_length_m,
    write_gpx as import_write_gpx,
)
from scrape_gpx import extract_strava_stream  # noqa: E402

try:
    import gpxpy
except ImportError:
    sys.exit("gpxpy is required: pip install -r scripts/requirements.txt")

try:
    from playwright.async_api import async_playwright, Page, Response
except ImportError:
    sys.exit("playwright is required: pip install -r scripts/requirements.txt")


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
VIEWPORT = {"width": 1440, "height": 900}

logging.addLevelName(25, "SUCCESS")


def success_log(self: logging.Logger, message: str, *args: Any, **kwargs: Any) -> None:
    self.log(25, message, *args, **kwargs)


logging.Logger.success = success_log  # type: ignore[attr-defined]


class ColorFormatter(logging.Formatter):
    COLORS = {
        "SUCCESS": "\033[92m",
        "INFO": "\033[94m",
        "WARNING": "\033[93m",
        "ERROR": "\033[91m",
        "CRITICAL": "\033[91m",
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        level = record.levelname
        prefix = f"{self.COLORS.get(level, '')}{level:>8}{self.RESET}"
        return f"{prefix} | {record.getMessage()}"


logger = logging.getLogger("route-scraper")
handler = logging.StreamHandler()
handler.setFormatter(ColorFormatter())
logger.addHandler(handler)
logger.setLevel(logging.INFO)


Point = tuple[float, float, float | None]


# ---------------------------------------------------------------------------
# Coordinate extraction
# ---------------------------------------------------------------------------


def is_lng(x: Any) -> bool:
    return isinstance(x, (int, float)) and -180 <= float(x) <= 180


def is_lat(y: Any) -> bool:
    return isinstance(y, (int, float)) and -90 <= float(y) <= 90


def looks_like_coord_pair(pair: list[Any]) -> bool:
    return (
        isinstance(pair, (list, tuple))
        and len(pair) >= 2
        and is_lng(pair[0])
        and is_lat(pair[1])
    )


def looks_like_coord_obj(obj: dict[str, Any]) -> bool:
    if not isinstance(obj, dict):
        return False
    lat = obj.get("lat") if "lat" in obj else obj.get("latitude") if "latitude" in obj else obj.get("y")
    lng = obj.get("lon") if "lon" in obj else obj.get("lng") if "lng" in obj else obj.get("longitude") if "longitude" in obj else obj.get("x")
    return is_lat(lat) and is_lng(lng)


def extract_points_from_value(value: Any) -> list[Point] | None:
    """Best-effort recursive extraction of coordinate arrays from JSON."""
    if isinstance(value, dict):
        # GeoJSON LineString / MultiPoint
        coords = value.get("coordinates")
        if isinstance(coords, list) and coords:
            # GeoJSON is [lng, lat, (ele)]
            pts: list[Point] = []
            for c in coords:
                if isinstance(c, (list, tuple)) and len(c) >= 2 and is_lng(c[0]) and is_lat(c[1]):
                    ele = float(c[2]) if len(c) >= 3 and isinstance(c[2], (int, float)) else None
                    pts.append((float(c[0]), float(c[1]), ele))
            if len(pts) >= 2:
                return pts
        # Strava-style stream arrays
        for key in ("latlng", "polyline", "coordinates"):
            if key in value:
                pts = extract_points_from_value(value[key])
                if pts:
                    return pts
        # Try every value
        for v in value.values():
            pts = extract_points_from_value(v)
            if pts:
                return pts
        return None

    if isinstance(value, list):
        if not value:
            return None
        # List of coordinate pairs / triples
        if looks_like_coord_pair(value[0]):
            pts: list[Point] = []
            for item in value:
                if isinstance(item, (list, tuple)) and len(item) >= 2 and is_lng(item[0]) and is_lat(item[1]):
                    ele = float(item[2]) if len(item) >= 3 and isinstance(item[2], (int, float)) else None
                    pts.append((float(item[0]), float(item[1]), ele))
            if len(pts) >= 2:
                return pts
        # List of coordinate objects
        if isinstance(value[0], dict) and looks_like_coord_obj(value[0]):
            pts = []
            for item in value:
                if not isinstance(item, dict):
                    continue
                lat = item.get("lat") if "lat" in item else item.get("latitude") if "latitude" in item else item.get("y")
                lng = item.get("lon") if "lon" in item else item.get("lng") if "lng" in item else item.get("longitude") if "longitude" in item else item.get("x")
                if is_lat(lat) and is_lng(lng):
                    ele = (
                        item.get("ele") if "ele" in item else
                        item.get("elevation") if "elevation" in item else
                        item.get("altitude") if "altitude" in item else
                        item.get("alt") if "alt" in item else None
                    )
                    ele_f = float(ele) if isinstance(ele, (int, float)) else None
                    pts.append((float(lng), float(lat), ele_f))
            if len(pts) >= 2:
                return pts
        # Nested lists (recurse shallowly to avoid huge scans)
        for item in value[:200]:
            pts = extract_points_from_value(item)
            if pts:
                return pts
        return None

    return None


# ---------------------------------------------------------------------------
# Adapters
# ---------------------------------------------------------------------------


class BaseAdapter:
    name = "base"

    def matches(self, url: str) -> bool:
        return True

    async def navigate(self, page: Page, url: str, wait_seconds: int) -> None:
        await page.goto(url, wait_until="networkidle", timeout=120_000)
        await asyncio.sleep(random.uniform(wait_seconds * 0.5, wait_seconds * 1.0))

    async def process_response(self, response: Response) -> list[Point] | None:
        return None


class StravaAdapter(BaseAdapter):
    name = "strava"

    def __init__(self) -> None:
        self.route_id: str | None = None

    def matches(self, url: str) -> bool:
        return "strava.com/routes/" in url

    async def navigate(self, page: Page, url: str, wait_seconds: int) -> None:
        match = re.search(r"strava\.com/routes/(\d+)", url)
        self.route_id = match.group(1) if match else None
        # Prefer the official API if a token exists — this avoids bot detection entirely.
        self.api_points: list[Point] | None = None
        try:
            from import_gpx import read_env_token, from_strava  # type: ignore[attr-defined]
            token = read_env_token("STRAVA_ACCESS_TOKEN")
            if self.route_id and token:
                logger.info("Using official Strava API for route %s", self.route_id)
                raw = from_strava(self.route_id)
                _name, points, _has_track = import_parse_gpx(raw)
                self.api_points = [(p[1], p[0], p[2]) for p in points]
                return
        except Exception as exc:
            logger.warning("Could not use official Strava API: %s", exc)
        await page.goto(url, wait_until="networkidle", timeout=120_000)
        await asyncio.sleep(random.uniform(wait_seconds * 0.5, wait_seconds * 1.0))

    async def process_response(self, response: Response) -> list[Point] | None:
        if self.api_points:
            return self.api_points
        url = response.url
        if not ("strava.com" in url and ("stream" in url.lower() or ".json" in url)):
            return None
        try:
            body = await response.json()
        except Exception:
            return None
        pts = extract_points_from_value(body)
        if pts:
            logger.info("Intercepted Strava stream response with %d points", len(pts))
        return pts


class KomootAdapter(BaseAdapter):
    name = "komoot"

    def matches(self, url: str) -> bool:
        return "komoot." in url and "/tour/" in url

    async def navigate(self, page: Page, url: str, wait_seconds: int) -> None:
        match = re.search(r"komoot\.(?:com|de|fr|es|it|nl)/tour/(\d+)", url)
        tour_id = match.group(1) if match else None
        if tour_id:
            # Komoot has a public GPX endpoint for tours.
            gpx_url = f"https://www.komoot.com/api/v07/tours/{tour_id}.gpx"
            logger.info("Trying Komoot GPX endpoint %s", gpx_url)
            await page.goto(gpx_url, wait_until="networkidle", timeout=120_000)
        else:
            await page.goto(url, wait_until="networkidle", timeout=120_000)
        await asyncio.sleep(random.uniform(wait_seconds * 0.5, wait_seconds * 1.0))

    async def process_response(self, response: Response) -> list[Point] | None:
        content_type = response.headers.get("content-type", "")
        if "gpx" not in content_type.lower() and not response.url.lower().endswith(".gpx"):
            return None
        try:
            text = await response.text()
            name, points, _ = import_parse_gpx(text.encode("utf-8"))
            if points:
                logger.info("Intercepted Komoot GPX response with %d points", len(points))
            return [(p[1], p[0], p[2]) for p in points]
        except Exception:
            return None


class WikilocAdapter(BaseAdapter):
    name = "wikiloc"

    def matches(self, url: str) -> bool:
        return "wikiloc.com" in url

    async def navigate(self, page: Page, url: str, wait_seconds: int) -> None:
        await page.goto(url, wait_until="networkidle", timeout=120_000)
        # Give the map time to fetch its track tiles/vectors.
        await asyncio.sleep(random.uniform(wait_seconds * 0.8, wait_seconds * 1.5))

    async def process_response(self, response: Response) -> list[Point] | None:
        url = response.url.lower()
        if "wikiloc" not in url:
            return None
        if not (url.endswith(".json") or "track" in url or "route" in url or "gpx" in url):
            return None
        try:
            body = await response.json()
        except Exception:
            try:
                text = await response.text()
                body = json.loads(text)
            except Exception:
                return None
        pts = extract_points_from_value(body)
        if pts:
            logger.info("Intercepted Wikiloc response with %d points", len(pts))
        return pts


class GenericAdapter(BaseAdapter):
    name = "generic"

    async def process_response(self, response: Response) -> list[Point] | None:
        content_type = response.headers.get("content-type", "").lower()
        url = response.url.lower()
        if url.endswith(".gpx") or "gpx" in content_type:
            try:
                text = await response.text()
                _name, points, _ = import_parse_gpx(text.encode("utf-8"))
                if points:
                    logger.info("Intercepted GPX response with %d points from %s", len(points), response.url)
                return [(p[1], p[0], p[2]) for p in points]
            except Exception:
                return None
        if "json" not in content_type:
            return None
        try:
            body = await response.json()
        except Exception:
            return None
        pts = extract_points_from_value(body)
        if pts and len(pts) >= 10:
            logger.info("Intercepted JSON response with %d points from %s", len(pts), response.url)
            return pts
        return None


# ---------------------------------------------------------------------------
# Browser / scraper
# ---------------------------------------------------------------------------


def stealth_script() -> str:
    """Hide common automation signals from page scripts."""
    return """
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {} };
    Object.defineProperty(window, 'outerWidth', { get: () => %d });
    Object.defineProperty(window, 'outerHeight', { get: () => %d });
    """ % (VIEWPORT["width"] + random.randint(0, 20), VIEWPORT["height"] + random.randint(0, 20))


async def launch_context(playwright, args: argparse.Namespace):
    browser = await playwright.chromium.launch(
        headless=args.headless,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--disable-setuid-sandbox",
            "--no-sandbox",
            "--disable-infobars",
            "--window-size=%d,%d" % (VIEWPORT["width"], VIEWPORT["height"]),
            "--disable-web-security",
            "--disable-features=IsolateOrigins,site-per-process",
        ],
    )
    context_kwargs: dict[str, Any] = {
        "user_agent": USER_AGENT,
        "viewport": VIEWPORT,
        "locale": "en-US",
        "timezone_id": "America/New_York",
        "permissions": ["geolocation"],
        "record_video_dir": None,
    }
    if args.state and Path(args.state).exists():
        logger.info("Loading saved browser state from %s", args.state)
        context_kwargs["storage_state"] = args.state
    elif args.cookies and Path(args.cookies).exists():
        logger.info("Loading cookies from %s", args.cookies)
        context_kwargs["storage_state"] = args.cookies
    context = await browser.new_context(**context_kwargs)
    await context.add_init_script(stealth_script())
    return browser, context


class RouteScraper:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.adapters: list[BaseAdapter] = [
            StravaAdapter(),
            KomootAdapter(),
            WikilocAdapter(),
            GenericAdapter(),
        ]
        self.points: list[Point] = []
        self.source_urls: list[str] = []

    def pick_adapter(self, url: str) -> BaseAdapter:
        for adapter in self.adapters:
            if adapter.matches(url):
                logger.info("Using %s adapter for %s", adapter.name, url)
                return adapter
        logger.info("Using generic adapter for %s", url)
        return self.adapters[-1]

    async def run(self) -> list[Path]:
        out_paths: list[Path] = []
        async with async_playwright() as p:
            browser, context = await launch_context(p, self.args)
            page = await context.new_page()

            async def on_response(response: Response) -> None:
                adapter = self.current_adapter
                try:
                    pts = await adapter.process_response(response)
                    if pts and len(pts) >= 2:
                        self.points.extend(pts)
                        self.source_urls.append(response.url)
                except Exception as exc:
                    logger.debug("Response handler error: %s", exc)

            page.on("response", lambda response: asyncio.create_task(on_response(response)))

            try:
                for url in self.args.urls:
                    self.points = []
                    self.source_urls = []
                    self.current_adapter = self.pick_adapter(url)
                    logger.info("Navigating to %s", url)
                    await self.current_adapter.navigate(page, url, self.args.wait)
                    await asyncio.sleep(random.uniform(1.0, 2.5))

                    if self.args.save_state:
                        state_path = Path(self.args.save_state)
                        state_path.parent.mkdir(parents=True, exist_ok=True)
                        await context.storage_state(path=str(state_path))
                        logger.success("Saved browser state to %s", state_path)

                    if not self.points:
                        # Final attempt: scrape the page HTML for embedded scripts.
                        html = await page.content()
                        if self.current_adapter.name == "strava":
                            pts = extract_strava_stream(html)
                        else:
                            pts = extract_points_from_html(html)
                        if pts:
                            self.points = pts
                            self.source_urls.append(url)

                    if not self.points:
                        logger.warning("No coordinates intercepted for %s", url)
                        continue

                    out_paths.append(self.save_route(url))
            finally:
                await context.close()
                await browser.close()
        return out_paths

    def save_route(self, source_url: str) -> Path:
        name = self.args.name or f"Imported route from {self.current_adapter.name}"
        base_slug = slugify(name)
        slug = base_slug
        counter = 1
        gpx_path = ROUTE_DIR / f"{slug}.gpx"
        while gpx_path.exists():
            slug = f"{base_slug}-{counter}"
            gpx_path = ROUTE_DIR / f"{slug}.gpx"
            counter += 1

        note = f"Intercepted from {', '.join(self.source_urls[:3])}"
        if self.args.licence:
            note += f" · {self.args.licence}"
        pts_for_gpx: list[tuple[float, float, float | None]] = [
            (lat, lon, ele) for lon, lat, ele in self.points
        ]
        raw = import_write_gpx(name, pts_for_gpx, note)
        ROUTE_DIR.mkdir(parents=True, exist_ok=True)
        gpx_path.write_bytes(raw)

        sidecar = ROUTE_DIR / f"{slug}.json"
        sidecar.write_text(
            json.dumps(
                {
                    "name": name,
                    "sourceUrl": source_url,
                    "licence": self.args.licence or "Check source site terms",
                    "contributor": self.args.contributor,
                    "interceptor": "scrape_routes_playwright.py",
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        length_km = track_length_m(pts_for_gpx) / 1000
        logger.success(
            "Saved %s: %d points, %.2f km -> %s",
            name,
            len(pts_for_gpx),
            length_km,
            gpx_path.relative_to(REPO_ROOT),
        )
        return gpx_path


def extract_points_from_html(html: str) -> list[Point] | None:
    """Fallback: scan inline JSON/script blocks for coordinate arrays."""
    # Strava-style inline latlng stream
    for script in re.findall(r"<script[^>]*>(.*?)</script>", html, re.S):
        for block in re.findall(r"\{[^{}]*\"latlng\"[^{}]*\}", script):
            try:
                data = json.loads(block)
                pts = extract_points_from_value(data)
                if pts:
                    return pts
            except json.JSONDecodeError:
                continue
    # Generic JSON-LD / geo arrays
    candidates = re.findall(r"\"coordinates\"\s*:\s*(\[[^\]]{50,5000}\])", html)
    for candidate in candidates:
        try:
            coords = json.loads(candidate)
            pts = extract_points_from_value({"coordinates": coords})
            if pts:
                return pts
        except json.JSONDecodeError:
            continue
    return None


def build(args: argparse.Namespace) -> None:
    if not args.build:
        logger.info("Pass --build to regenerate public/data/routes.json")
        return
    logger.info("Running scripts/build_data.py")
    result = subprocess.run(
        [sys.executable, "scripts/build_data.py"],
        cwd=REPO_ROOT,
        check=False,
    )
    if result.returncode != 0:
        logger.error("build_data.py failed with exit code %d", result.returncode)
    else:
        logger.success("Application dataset rebuilt")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape GPX routes from dynamic sites using Playwright network interception."
    )
    parser.add_argument("urls", nargs="+", help="One or more route page URLs")
    parser.add_argument("--name", help="Route display name (default: auto-generated)")
    parser.add_argument("--contributor", help="Your GitHub handle, e.g. @octocat")
    parser.add_argument("--licence", help='Licence or permission note, e.g. "CC BY-SA 4.0"')
    parser.add_argument("--state", help="Playwright storage-state JSON file to load (and --save-state path)")
    parser.add_argument("--cookies", help="Alias for --state")
    parser.add_argument("--save-state", action="store_true", help="Save the browser session after navigation")
    parser.add_argument("--headless", action=argparse.BooleanOptionalAction, default=True, help="Run browser headlessly")
    parser.add_argument("--wait", type=int, default=5, help="Seconds to wait after the page loads")
    parser.add_argument("--build", action="store_true", help="Run scripts/build_data.py afterwards")
    parser.add_argument("--output-dir", default=str(ROUTE_DIR), help=argparse.SUPPRESS)
    return parser.parse_args(argv)


async def main_async(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.cookies and not args.state:
        args.state = args.cookies
    if args.save_state and not args.state:
        args.state = str(REPO_ROOT / "state.json")

    logger.warning(
        "Only scrape routes you have permission to republish. "
        "Strava/AllTrails/Wikiloc terms may prohibit scraping without consent."
    )

    scraper = RouteScraper(args)
    paths = await scraper.run()
    if not paths:
        logger.error("No GPX files generated. Try --headless=false to log in manually, then --save-state.")
        return 1

    build(args)
    logger.success("Done. %d route(s) added under data/routes/", len(paths))
    return 0


def main() -> int:
    return asyncio.run(main_async())


if __name__ == "__main__":
    sys.exit(main())
