#!/usr/bin/env python3
"""
Singapore's neighbourhoods for search: URA Master Plan 2019 planning areas and
subzones, as names and boxes, written to src/lib/sgAreas.json.

Photon (the geocoder) answers Singapore names with stations, buildings and
estates rather than the neighbourhood, and only runs on submit. A local list
gives real outlines and suggestions as you type.

Source: "Master Plan 2019 Subzone Boundary (No Sea)" on data.gov.sg, under the
Singapore Open Data Licence v1.0 (attribution required; see the Terms page and
the README). The No Sea version keeps coastal boxes off the water. Only names
and boxes are kept, not the shapes.

Standard library only. The download is cached in scripts/.cache/; pass
--refresh to fetch it again.

    python3 scripts/build_sg_areas.py
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_peaks import ssl_context  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache" / "ura-mp2019-subzones-nosea.geojson"
OUT = ROOT / "src" / "lib" / "sgAreas.json"
DATASET = "d_8594ae9ff96d0c708bc2af633048edfb"
POLL = f"https://api-open.data.gov.sg/v1/public/api/datasets/{DATASET}/poll-download"
DATASET_NAME = "Master Plan 2019 Subzone Boundary (No Sea)"

# Names people type that are not planning areas or subzones, each pointing at
# the subzones that make it up (their boxes are joined). Keep this short and
# real: places a runner would search for. A park inside a much larger subzone
# or a village (MacRitchie in the Central Water Catchment, the Botanic
# Gardens, Holland Village across two long subzones, UTown inside the
# whole campus) is left to
# the geocoder, which knows its outline.
ALIASES: dict[str, list[str]] = {
    "Buona Vista": ["One North", "Dover", "Holland Drive"],
    "NUS": ["National University of S'pore", "Kent Ridge"],
    "Southern Ridges": ["Telok Blangah Rise", "Telok Blangah Way", "Kent Ridge", "Henderson Hill"],
    "Marina Bay": ["Marina Centre", "Bayfront Subzone", "Marina South", "Straits View"],
}

# Beware lookalikes: URA's "Faber" is Faber Hills in Clementi, not Mount Faber.

# URA's names are upper case; a few read better than plain title case.
SPELLING = {
    "One North": "one-north",
    "National University of S'pore": "National University of Singapore",
    "Bayfront Subzone": "Bayfront",
}
LOWER_WORDS = {"of", "and"}


def title(name: str) -> str:
    """"NORTH-EASTERN ISLANDS" -> "North-Eastern Islands"; "(MP)" and "IND" kept short and readable."""
    def word(i: int, w: str) -> str:
        if w.startswith("("):
            return w.upper()
        if i and w in LOWER_WORDS:
            return w
        return "-".join(part[:1].upper() + part[1:] for part in w.split("-"))

    return " ".join(word(i, w) for i, w in enumerate(name.lower().replace(" ind estate", " Industrial Estate").split()))


def download(refresh: bool) -> dict:
    if CACHE.exists() and not refresh:
        return json.loads(CACHE.read_text())
    ctx = ssl_context()
    with urllib.request.urlopen(POLL, context=ctx, timeout=60) as response:
        url = json.load(response)["data"]["url"]
    with urllib.request.urlopen(url, context=ctx, timeout=120) as response:
        body = response.read()
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_bytes(body)
    return json.loads(body)


def points(geometry: dict):
    coords = geometry["coordinates"]
    polygons = coords if geometry["type"] == "MultiPolygon" else [coords]
    for polygon in polygons:
        for ring in polygon:
            for lng, lat, *_ in ring:
                yield lng, lat


def join(boxes: list[list[float]]) -> list[float]:
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--refresh", action="store_true", help="download the boundaries again")
    args = parser.parse_args()

    geojson = download(args.refresh)
    subzones: dict[str, tuple[str, list[float]]] = {}
    planning: dict[str, list[list[float]]] = {}
    for feature in geojson["features"]:
        props = feature["properties"]
        xs, ys = zip(*points(feature["geometry"]))
        box = [min(xs), min(ys), max(xs), max(ys)]
        area = title(props["PLN_AREA_N"])
        subzones[title(props["SUBZONE_N"])] = (area, box)
        planning.setdefault(area, []).append(box)

    areas: list[dict] = []
    for name, boxes in sorted(planning.items()):
        areas.append({"name": name, "kind": "area", "b": join(boxes)})
    names = {a["name"].lower() for a in areas}
    for raw, (parent, box) in sorted(subzones.items()):
        name = SPELLING.get(raw, raw)
        # "Bedok North" stays; a subzone named like its planning area does not.
        if name.lower() in names:
            continue
        names.add(name.lower())
        areas.append({"name": name, "kind": "subzone", "in": parent, "b": box})
    for alias, parts in ALIASES.items():
        missing = [p for p in parts if p not in subzones]
        if missing:
            sys.exit(f"Alias {alias!r}: no subzone named {missing} (check the URA names)")
        if alias.lower() in names:
            continue
        parent = subzones[parts[0]][0]
        areas.append({"name": alias, "kind": "alias", "in": parent, "b": join([subzones[p][1] for p in parts])})
        names.add(alias.lower())

    for area in areas:
        area["b"] = [round(v, 4) for v in area["b"]]
    out = {
        "source": {
            "dataset": DATASET_NAME,
            "accessed": dt.date.today().isoformat(),
            "from": "data.gov.sg",
            "licence": "Singapore Open Data Licence version 1.0",
        },
        "areas": areas,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    counts = {k: sum(a["kind"] == k for a in areas) for k in ("area", "subzone", "alias")}
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(areas)} places: {counts}, {OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
