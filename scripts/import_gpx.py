#!/usr/bin/env python3
"""
Import a route into data/routes/ as <slug>.gpx plus a provenance sidecar.

    python3 scripts/import_gpx.py ~/Downloads/run.gpx --name "Kent Ridge repeats" \
        --contributor @you --licence "CC BY 4.0"
    python3 scripts/import_gpx.py https://example.org/route.gpx --licence "CC0"
    python3 scripts/import_gpx.py --osm-relation 5993965
    python3 scripts/import_gpx.py --strava-route 1234567890 --contributor @you
    python3 scripts/import_gpx.py ... --dry-run

Sources:

* A local path or an http(s) URL to a .gpx. It must parse as GPX and hold at
  least two <trkpt> or <rtept> points. Files with only a <rte> are converted to
  a <trk> so every route in the repo has the same shape; files with a <trk> are
  copied byte-for-byte.

* --osm-relation <id>: an OpenStreetMap route relation (route=hiking, foot,
  running, ...) fetched from Overpass. Member ways are stitched into one track
  by greedy nearest-endpoint chaining, reversing ways as needed — best-effort,
  so check the result on the map; branching relations produce jumps, which are
  reported as gaps. Licence is set to "ODbL © OpenStreetMap contributors" and
  sourceUrl to the relation's page. OSM has no elevations; build_data.py
  re-samples from the terrain model where it has coverage.

* --strava-route <id>: the OFFICIAL Strava API endpoint
  GET /api/v3/routes/{id}/export_gpx, authenticated with STRAVA_ACCESS_TOKEN
  (from the environment or .env.local). This works for routes the token's
  owner can access — in practice, your own routes. Scraping Strava web pages is
  against Strava's terms of service, so this tool never does it; if you want
  someone else's route, ask them to export and contribute it themselves.

The sidecar (<slug>.json) records name, contributor, licence and sourceUrl, all
of which build_data.py passes through into public/data/routes.json. An existing
sidecar with the same slug is updated, not replaced, so hand-written fields such
as description or venues survive a re-import.

Standard library only. Nothing is written with --dry-run.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
ROUTE_DIR = os.path.join(REPO_ROOT, "data", "routes")
ENV_FILE = os.path.join(REPO_ROOT, ".env.local")

sys.path.insert(0, SCRIPT_DIR)
from fetch_peaks import OVERPASS_URLS, USER_AGENT, ssl_context  # noqa: E402

GPX_NS = "http://www.topografix.com/GPX/1/1"
OSM_LICENCE = "ODbL © OpenStreetMap contributors"
MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
TIMEOUT_S = 90

Point = tuple[float, float, "float | None"]  # lat, lon, ele


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def slugify(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")


def haversine_m(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    r = 6371008.8
    d_lat = math.radians(b_lat - a_lat)
    d_lon = math.radians(b_lon - a_lon)
    s = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lon / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(s))


def http(url: str, *, data: bytes | None = None, headers: dict | None = None, retries: int = 3) -> bytes:
    """GET/POST with a User-Agent, timeout, size cap and polite retries."""
    context = ssl_context()
    last: Exception | None = None
    for attempt in range(retries):
        request = urllib.request.Request(
            url, data=data, headers={"User-Agent": USER_AGENT, **(headers or {})}
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_S, context=context) as resp:
                body = resp.read(MAX_DOWNLOAD_BYTES + 1)
            if len(body) > MAX_DOWNLOAD_BYTES:
                sys.exit(f"Download larger than {MAX_DOWNLOAD_BYTES // (1024 * 1024)} MB; refusing")
            return body
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code in (429, 502, 503, 504) and attempt < retries - 1:
                wait = 15 * (attempt + 1)
                print(f"  HTTP {exc.code} from {urllib.parse.urlsplit(url).netloc}; retrying in {wait}s")
                time.sleep(wait)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last = exc
            if attempt < retries - 1:
                wait = 10 * (attempt + 1)
                print(f"  {exc!r}; retrying in {wait}s")
                time.sleep(wait)
                continue
            raise
    raise RuntimeError(f"request failed: {last!r}")


def read_env_token(name: str) -> str | None:
    """Environment first, then a minimal KEY=VALUE parse of .env.local."""
    value = os.environ.get(name)
    if value:
        return value.strip()
    if not os.path.exists(ENV_FILE):
        return None
    with open(ENV_FILE, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            if key.startswith("export "):
                key = key[len("export "):].strip()
            if key == name:
                val = val.strip()
                if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
                    val = val[1:-1]
                return val or None
    return None


# ---------------------------------------------------------------------------
# GPX parsing and writing
# ---------------------------------------------------------------------------


def parse_gpx(content: bytes) -> tuple[str | None, list[Point], bool]:
    """Return (name, points, has_track). Raises ValueError when unusable."""
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise ValueError(f"not valid XML: {exc}") from exc
    if not root.tag.endswith("gpx"):
        raise ValueError(f"root element is <{root.tag}>, not <gpx>")

    def find_all(tag: str) -> list[ET.Element]:
        nodes = root.findall(f".//{{{GPX_NS}}}{tag}")
        if not nodes:
            nodes = root.findall(f".//{tag}")
        if not nodes:  # GPX 1.0 or another namespace
            nodes = [el for el in root.iter() if el.tag.rsplit("}", 1)[-1] == tag]
        return nodes

    def child(el: ET.Element, tag: str) -> ET.Element | None:
        for c in el:
            if c.tag.rsplit("}", 1)[-1] == tag:
                return c
        return None

    trkpts = find_all("trkpt")
    nodes = trkpts or find_all("rtept")
    points: list[Point] = []
    for node in nodes:
        try:
            lat = float(node.attrib["lat"])
            lon = float(node.attrib["lon"])
        except (KeyError, ValueError):
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        ele_node = child(node, "ele")
        ele: float | None = None
        if ele_node is not None and ele_node.text:
            try:
                ele = float(ele_node.text)
            except ValueError:
                ele = None
        points.append((lat, lon, ele))

    if len(points) < 2:
        raise ValueError(f"only {len(points)} usable <trkpt>/<rtept> points; need at least 2")

    name = None
    for container in ("trk", "rte", "metadata"):
        for el in find_all(container):
            n = child(el, "name")
            if n is not None and n.text and n.text.strip():
                name = n.text.strip()
                break
        if name:
            break
    return name, points, bool(trkpts)


def write_gpx(name: str, points: list[Point], creator_note: str) -> bytes:
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<gpx version="1.1" creator="HillGPX import_gpx.py" xmlns="{GPX_NS}">',
        "  <metadata>",
        f"    <name>{escape(name)}</name>",
        f"    <desc>{escape(creator_note)}</desc>",
        "  </metadata>",
        "  <trk>",
        f"    <name>{escape(name)}</name>",
        "    <trkseg>",
    ]
    for lat, lon, ele in points:
        if ele is None:
            lines.append(f'      <trkpt lat="{lat:.7f}" lon="{lon:.7f}"/>')
        else:
            lines.append(f'      <trkpt lat="{lat:.7f}" lon="{lon:.7f}"><ele>{ele:.1f}</ele></trkpt>')
    lines += ["    </trkseg>", "  </trk>", "</gpx>", ""]
    return "\n".join(lines).encode("utf-8")


def track_length_m(points: list[Point]) -> float:
    return sum(
        haversine_m(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
        for i in range(1, len(points))
    )


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------


def load_path_or_url(src: str) -> tuple[bytes, str]:
    if re.match(r"^https?://", src, re.I):
        print(f"Downloading {src}")
        return http(src), os.path.basename(urllib.parse.urlsplit(src).path) or "route"
    path = os.path.expanduser(src)
    if not os.path.isfile(path):
        sys.exit(f"No such file: {src}")
    with open(path, "rb") as fh:
        return fh.read(), os.path.basename(path)


def stitch(ways: list[list[tuple[float, float]]]) -> tuple[list[tuple[float, float]], list[float]]:
    """
    Greedy chaining of way geometries into a single line.

    Starting from the first member way, repeatedly attach whichever remaining
    way has an endpoint nearest to either end of the chain, reversing it if
    needed. Returns the line and the list of gaps (metres) bridged on the way.
    """
    remaining = [w for w in ways if len(w) >= 2]
    if not remaining:
        return [], []
    chain = list(remaining.pop(0))
    gaps: list[float] = []

    def d(a: tuple[float, float], b: tuple[float, float]) -> float:
        return haversine_m(a[0], a[1], b[0], b[1])

    while remaining:
        best = None  # (distance, index, attach_at_end, reverse)
        head, tail = chain[0], chain[-1]
        for i, way in enumerate(remaining):
            for dist, at_end, rev in (
                (d(tail, way[0]), True, False),
                (d(tail, way[-1]), True, True),
                (d(head, way[-1]), False, False),
                (d(head, way[0]), False, True),
            ):
                if best is None or dist < best[0]:
                    best = (dist, i, at_end, rev)
        assert best is not None
        dist, i, at_end, rev = best
        way = remaining.pop(i)
        if rev:
            way = list(reversed(way))
        if dist > 1.0:
            gaps.append(dist)
        if at_end:
            chain.extend(way[1:] if dist <= 1.0 else way)
        else:
            chain[:0] = way[:-1] if dist <= 1.0 else way
    return chain, gaps


def from_osm_relation(rel_id: int) -> tuple[str | None, list[Point], dict]:
    # The relation itself plus any child relations (superroutes), with way
    # geometry inline so no separate node lookup is needed.
    query = f"[out:json][timeout:120];relation({rel_id});(._;rel(r););out geom;"
    body = urllib.parse.urlencode({"data": query}).encode()
    data = None
    last: Exception | None = None
    for url in OVERPASS_URLS:
        try:
            print(f"Querying {url} for relation {rel_id}")
            data = json.loads(http(url, data=body))
            break
        except Exception as exc:  # try the mirror
            last = exc
            print(f"  failed: {exc!r}")
    if data is None:
        sys.exit(f"Overpass request failed: {last!r}")

    relations = {el["id"]: el for el in data.get("elements", []) if el.get("type") == "relation"}
    if rel_id not in relations:
        sys.exit(f"Relation {rel_id} not found on OpenStreetMap")
    top = relations[rel_id]
    tags = top.get("tags", {})

    ways: list[list[tuple[float, float]]] = []
    seen_rel: set[int] = set()

    def collect(rel: dict) -> None:
        if rel["id"] in seen_rel:
            return
        seen_rel.add(rel["id"])
        for m in rel.get("members", []):
            if m.get("type") == "way" and m.get("geometry"):
                # Skip platforms, guideposts and the like; keep route segments.
                if m.get("role", "") in ("", "forward", "backward", "main", "alternative", "route"):
                    ways.append([(g["lat"], g["lon"]) for g in m["geometry"] if g])
            elif m.get("type") == "relation" and m.get("ref") in relations:
                collect(relations[m["ref"]])

    collect(top)
    if not ways:
        sys.exit(f"Relation {rel_id} has no way members with geometry")

    line, gaps = stitch(ways)
    print(f"  {tags.get('route', '?')} relation '{tags.get('name', rel_id)}': {len(ways)} ways stitched")
    big = [g for g in gaps if g > 50]
    if big:
        print(
            f"  Warning: {len(big)} gap(s) over 50 m bridged (largest {max(big):.0f} m) — "
            "the relation may branch or be incomplete; check it on the map"
        )
    name = tags.get("name:en") or tags.get("name")
    info = {"route": tags.get("route"), "gaps": gaps}
    return name, [(lat, lon, None) for lat, lon in line], info


def from_strava(route_id: str) -> bytes:
    token = read_env_token("STRAVA_ACCESS_TOKEN")
    if not token:
        sys.exit(
            "STRAVA_ACCESS_TOKEN is not set.\n"
            "  Create an API application at https://www.strava.com/settings/api, obtain an\n"
            "  access token with the read_all scope for your own account, and put\n"
            "  STRAVA_ACCESS_TOKEN=... in .env.local (never commit it) or the environment.\n"
            "  This uses the official API only and works for routes your account can access;\n"
            "  it does not scrape strava.com, which Strava's terms forbid."
        )
    url = f"https://www.strava.com/api/v3/routes/{route_id}/export_gpx"
    print(f"Requesting {url} (official Strava API)")
    try:
        return http(url, headers={"Authorization": f"Bearer {token}"}, retries=2)
    except urllib.error.HTTPError as exc:
        hint = {
            401: "token invalid or expired — refresh it",
            403: "token lacks access — the route is private to another athlete or the scope is missing",
            404: "route not found or not visible to this token",
            429: "Strava rate limit reached — try again later",
        }.get(exc.code, "")
        sys.exit(f"Strava API returned HTTP {exc.code} {exc.reason}. {hint}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import a GPX (file, URL, OSM relation or your own Strava route) into data/routes/"
    )
    parser.add_argument("source", nargs="?", help="Path or http(s) URL of a .gpx file")
    parser.add_argument("--osm-relation", type=int, metavar="ID", help="OpenStreetMap route relation id")
    parser.add_argument(
        "--strava-route", metavar="ID", help="Your own Strava route id (official API; needs STRAVA_ACCESS_TOKEN)"
    )
    parser.add_argument("--name", help="Route name (default: from the GPX or relation)")
    parser.add_argument("--slug", help="Output basename (default: kebab-case of the name)")
    parser.add_argument("--contributor", help="Your GitHub handle, e.g. @octocat")
    parser.add_argument("--licence", help='Licence of the track, e.g. "CC BY 4.0" (OSM sets ODbL itself)')
    parser.add_argument("--source-url", help="Where the track came from")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing GPX with the same slug")
    parser.add_argument("--dry-run", action="store_true", help="Validate and report; write nothing")
    args = parser.parse_args()

    chosen = [x for x in (args.source, args.osm_relation, args.strava_route) if x]
    if len(chosen) != 1:
        parser.error("give exactly one of: a path/URL, --osm-relation ID, --strava-route ID")

    licence = args.licence
    source_url = args.source_url
    gpx_name: str | None
    fallback_name: str

    if args.osm_relation:
        gpx_name, points, _info = from_osm_relation(args.osm_relation)
        fallback_name = f"osm-relation-{args.osm_relation}"
        licence = licence or OSM_LICENCE
        source_url = source_url or f"https://www.openstreetmap.org/relation/{args.osm_relation}"
        raw = None
        has_track = False
    else:
        if args.strava_route:
            raw = from_strava(args.strava_route)
            fallback_name = f"strava-route-{args.strava_route}"
            source_url = source_url or f"https://www.strava.com/routes/{args.strava_route}"
        else:
            raw, fallback_name = load_path_or_url(args.source)
            fallback_name = os.path.splitext(fallback_name)[0]
            if re.match(r"^https?://", args.source, re.I):
                source_url = source_url or args.source
        try:
            gpx_name, points, has_track = parse_gpx(raw)
        except ValueError as exc:
            sys.exit(f"Not a usable GPX: {exc}")

    name = args.name or gpx_name or fallback_name.replace("-", " ").replace("_", " ").title()
    slug = slugify(args.slug or name) or slugify(fallback_name)
    if not slug:
        sys.exit("Could not derive a slug; pass --slug")

    contributor = args.contributor
    if contributor and not contributor.startswith("@"):
        contributor = "@" + contributor

    if raw is not None and has_track:
        out_bytes = raw  # keep the original file intact
        mode = "copied as-is (has <trk>)"
    else:
        note = f"Imported from {source_url}" if source_url else "Converted by HillGPX import_gpx.py"
        if licence:
            note += f" · {licence}"
        out_bytes = write_gpx(name, points, note)
        mode = "written from OSM geometry" if args.osm_relation else "converted <rte> to <trk>"

    gpx_path = os.path.join(ROUTE_DIR, f"{slug}.gpx")
    json_path = os.path.join(ROUTE_DIR, f"{slug}.json")

    sidecar: dict = {}
    if os.path.exists(json_path):
        with open(json_path, encoding="utf-8") as fh:
            sidecar = json.load(fh)
    sidecar["name"] = name
    for key, value in (("contributor", contributor), ("licence", licence), ("sourceUrl", source_url)):
        if value:
            sidecar[key] = value

    length_km = track_length_m(points) / 1000
    print(f"\nRoute:     {name}")
    print(f"Points:    {len(points):,}  ({length_km:.2f} km before simplification)")
    print(f"Start:     {points[0][0]:.5f}, {points[0][1]:.5f}")
    print(f"GPX:       {os.path.relpath(gpx_path, REPO_ROOT)}  [{mode}, {len(out_bytes) / 1024:.0f} KB]")
    print(f"Sidecar:   {os.path.relpath(json_path, REPO_ROOT)}")
    print("           " + json.dumps(sidecar, ensure_ascii=False))
    if not licence:
        print("  Note: no --licence given. Only contribute tracks you recorded or have permission to share.")

    if args.dry_run:
        print("\nDry run: nothing written.")
        return

    if os.path.exists(gpx_path) and not args.force:
        sys.exit(f"\n{os.path.relpath(gpx_path, REPO_ROOT)} already exists; pass --force or --slug")
    os.makedirs(ROUTE_DIR, exist_ok=True)
    with open(gpx_path, "wb") as fh:
        fh.write(out_bytes)
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(sidecar, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print("\nWritten. Next: python3 scripts/build_data.py  (then commit data/routes/ and public/data/)")


if __name__ == "__main__":
    main()
