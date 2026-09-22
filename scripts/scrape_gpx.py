#!/usr/bin/env python3
"""
Pull a GPX route from a web page.

    python3 scripts/scrape_gpx.py URL --name "Route name" [--contributor @handle]

The default handler downloads the HTML, looks for a link that ends in .gpx or
contains /export/gpx, /download/gpx, or a Strava route page, and saves the
result to data/routes/<slug>.gpx plus a sidecar JSON with source and licence.

Strava:
  Public Strava route pages do not expose a GPX button to visitors. The
  importer therefore prefers the official API: set STRAVA_ACCESS_TOKEN to a
  token with `read` scope and pass the route URL. The token is read from the
  environment or from a single line in `.env.local`. If no token is present,
  the script falls back to parsing the embedded route stream in the HTML, which
  works today for some public routes but may break whenever Strata changes its
  markup.

OSM relation:
  Use scripts/import_gpx.py --osm-relation instead; it is more reliable and
  the licence is known.

Only import routes you have permission to republish. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
OUT_DIR = REPO_ROOT / "data" / "routes"

USER_AGENT = "HillGPX/0.2 (open source; https://github.com/StarlightsJourney/HillGPX)"


def ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if ctx.get_ca_certs() or os.environ.get("SSL_CERT_FILE"):
        return ctx
    try:
        import certifi  # type: ignore[import-not-found]
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    for path in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"):
        if os.path.exists(path):
            return ssl.create_default_context(cafile=path)
    return ctx


def http_get(url: str, headers: dict[str, str] | None = None) -> tuple[bytes, str]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(request, timeout=120, context=ssl_context()) as resp:
        body = resp.read()
        content_type = resp.headers.get("Content-Type", "")
        charset = re.search(r"charset=([\w-]+)", content_type)
        encoding = charset.group(1) if charset else "utf-8"
        return body, encoding


def text_get(url: str, headers: dict[str, str] | None = None) -> str:
    body, encoding = http_get(url, headers)
    return body.decode(encoding, errors="replace")


def slugify(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")


def gpx_slug(name: str) -> str:
    return slugify(name) or "route"


class LinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []
        self.scripts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            for k, v in attrs:
                if k == "href" and v:
                    self.links.append(v)
        elif tag == "script":
            for k, v in attrs:
                if k == "src" and v:
                    self.scripts.append(v)

    def handle_data(self, data: str) -> None:
        self.scripts.append(data)


def absolute_url(base: str, href: str) -> str:
    if href.startswith(("http://", "https://")):
        return href
    return urllib.parse.urljoin(base, href)


def looks_like_gpx_url(href: str) -> bool:
    lower = href.lower()
    return lower.endswith(".gpx") or "/gpx" in lower or "/export" in lower or "/download" in lower


def find_gpx_link(html: str, base_url: str) -> str | None:
    extractor = LinkExtractor()
    extractor.feed(html)
    for href in extractor.links:
        if looks_like_gpx_url(href):
            return absolute_url(base_url, href)
    return None


def parse_strava_route_id(url: str) -> str | None:
    match = re.search(r"strava\.com/routes/(\d+)", url)
    return match.group(1) if match else None


def get_strava_token() -> str | None:
    token = os.environ.get("STRAVA_ACCESS_TOKEN")
    if token:
        return token
    env_path = REPO_ROOT / ".env.local"
    if env_path.exists():
        text = env_path.read_text(encoding="utf-8")
        for line in text.splitlines():
            if line.startswith("STRAVA_ACCESS_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def extract_strava_stream(html: str) -> list[tuple[float, float, float]] | None:
    """Best-effort extraction of lat/lng/ele arrays from Strava public HTML."""
    # The public page sometimes inlines a JSON payload with keys like
    # "latlng", "altitude" under a "stream" object. We scan all script tags.
    for script in re.findall(r"<script[^>]*>(.*?)</script>", html, re.S):
        # Try to find a JSON block that contains latlng pairs.
        for block in re.findall(r"\{[^{}]*\"latlng\"[^{}]*\}", script):
            try:
                data = json.loads(block)
                if isinstance(data, dict) and "latlng" in data:
                    latlng = data["latlng"]
                    altitude = data.get("altitude") or [0.0] * len(latlng)
                    if isinstance(latlng, list) and len(latlng) > 1:
                        return [(lng, lat, float(altitude[i] if i < len(altitude) else 0)) for i, (lat, lng) in enumerate(latlng)]
            except json.JSONDecodeError:
                continue
    # Fallback: scan for a polyline under "route" or "polyline".
    for match in re.finditer(r'"polyline"\s*:\s*"([^"]+)"', html):
        polyline = match.group(1)
        pts = decode_polyline(polyline)
        if pts:
            return [(lng, lat, 0.0) for lat, lng in pts]
    return None


def decode_polyline(polyline: str) -> list[tuple[float, float]] | None:
    """Google polyline decoder. Returns lat,lng tuples."""
    idx = 0
    lat = 0
    lng = 0
    out: list[tuple[float, float]] = []
    while idx < len(polyline):
        def get() -> int:
            nonlocal idx
            b = 0
            shift = 0
            while True:
                c = ord(polyline[idx]) - 63
                idx += 1
                b |= (c & 0x1F) << shift
                if c < 0x20:
                    break
                shift += 5
            return ~(b >> 1) if b & 1 else b >> 1
        lat += get()
        lng += get()
        out.append((lat / 1e5, lng / 1e5))
    return out if len(out) > 1 else None


def fetch_strava_api(route_id: str, token: str) -> list[tuple[float, float, float]]:
    url = f"https://www.strava.com/api/v3/routes/{route_id}/export_gpx"
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120, context=ssl_context()) as resp:
        gpx_bytes = resp.read()
    points = parse_gpx_points(gpx_bytes.decode("utf-8", errors="replace"))
    if not points:
        raise ValueError("Strava returned a GPX with no usable track points")
    return points


def parse_gpx_points(gpx: str) -> list[tuple[float, float, float]]:
    import xml.etree.ElementTree as ET
    ns_gpx = "{http://www.topografix.com/GPX/1/1}"
    try:
        root = ET.fromstring(gpx.encode("utf-8"))
    except ET.ParseError as exc:
        raise ValueError(f"Could not parse GPX: {exc}") from exc
    points: list[tuple[float, float, float]] = []
    for trkpt in root.iter(f"{ns_gpx}trkpt"):
        lat = float(trkpt.attrib.get("lat", 0))
        lon = float(trkpt.attrib.get("lon", 0))
        ele_node = trkpt.find(f"{ns_gpx}ele")
        ele = float(ele_node.text) if ele_node is not None and ele_node.text else 0.0
        points.append((lon, lat, ele))
    if not points:
        # Try without namespace
        for trkpt in root.iter("trkpt"):
            lat = float(trkpt.attrib.get("lat", 0))
            lon = float(trkpt.attrib.get("lon", 0))
            ele_node = trkpt.find("ele")
            ele = float(ele_node.text) if ele_node is not None and ele_node.text else 0.0
            points.append((lon, lat, ele))
    return points


def build_gpx(name: str, points: list[tuple[float, float, float]]) -> str:
    pts = "\n".join(
        f'        <trkpt lat="{lat}" lon="{lng}"><ele>{ele}</ele></trkpt>' for lng, lat, ele in points
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="hillGPX">
  <trk>
    <name>{name}</name>
    <trkseg>
{pts}
    </trkseg>
  </trk>
</gpx>"""


def save_route(name: str, gpx: str, source_url: str, licence: str, contributor: str | None) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    slug = gpx_slug(name)
    gpx_path = OUT_DIR / f"{slug}.gpx"
    sidecar = OUT_DIR / f"{slug}.json"
    counter = 1
    while gpx_path.exists():
        slug = f"{gpx_slug(name)}-{counter}"
        gpx_path = OUT_DIR / f"{slug}.gpx"
        sidecar = OUT_DIR / f"{slug}.json"
        counter += 1
    gpx_path.write_text(gpx, encoding="utf-8")
    sidecar.write_text(
        json.dumps({
            "name": name,
            "sourceUrl": source_url,
            "licence": licence,
            "contributor": contributor,
        }, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return gpx_path


def scrape(url: str, name: str | None, contributor: str | None) -> Path:
    source_url = url
    print(f"Fetching {url}")
    html = text_get(url)

    route_id = parse_strava_route_id(url)
    if route_id:
        print(f"Detected Strava route {route_id}")
        token = get_strava_token()
        if token:
            print("Using official Strava API")
            points = fetch_strava_api(route_id, token)
        else:
            print("No STRAVA_ACCESS_TOKEN found; trying embedded stream fallback")
            points = extract_strava_stream(html)
            if points is None:
                raise ValueError(
                    "Could not extract a route from the Strava page. "
                    "Set STRAVA_ACCESS_TOKEN or use the Strava app to export the GPX yourself."
                )
        gpx = build_gpx(name or f"Strava route {route_id}", points)
        return save_route(name or f"Strava route {route_id}", gpx, source_url, "Terms of Strava; republish only with permission", contributor)

    # Generic page: try to find a direct GPX link.
    gpx_url = find_gpx_link(html, url)
    if gpx_url:
        print(f"Found GPX link: {gpx_url}")
        body, encoding = http_get(gpx_url)
        text = body.decode(encoding, errors="replace")
        points = parse_gpx_points(text)
        if not points:
            raise ValueError(f"The linked file at {gpx_url} does not contain usable track points")
        gpx = build_gpx(name or "Imported route", points)
        return save_route(name or "Imported route", gpx, source_url, "Check source site terms", contributor)

    raise ValueError(
        "No .gpx link found on the page and the URL is not a Strava route. "
        "For OpenStreetMap relations use scripts/import_gpx.py --osm-relation."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape a GPX route from a web page")
    parser.add_argument("url", help="Page URL")
    parser.add_argument("--name", help="Route display name")
    parser.add_argument("--contributor", help="@github-handle of the person importing")
    args = parser.parse_args()

    path = scrape(args.url, args.name, args.contributor)
    print(f"Saved {path}")
    print("Next: python3 scripts/build_data.py")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
