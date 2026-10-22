#!/usr/bin/env python3
"""
Write the time zone -> country table that "Routes near me" falls back on when
someone does not share their location (and Cloudflare's country is not
available, as on localhost or the GitHub Pages copy).

    python3 scripts/build_timezones.py [path/to/zone.tab]

Reads  the IANA zone.tab (default /usr/share/zoneinfo/zone.tab; macOS and
       most Linuxes ship it)
Writes src/lib/timeZoneCountries.json  {"Asia/Singapore": "SG", ...}

Browsers report the zone ICU knows, which for a few places is the old name
(Chrome says "Asia/Calcutta", not "Asia/Kolkata"), so those aliases are added.
Standard library only.
"""

from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "timeZoneCountries.json")

# Old names ICU still hands out -> the zone.tab name they stand for.
ALIASES = {
    "Asia/Calcutta": "Asia/Kolkata",
    "Asia/Saigon": "Asia/Ho_Chi_Minh",
    "Asia/Katmandu": "Asia/Kathmandu",
    "Asia/Rangoon": "Asia/Yangon",
    "Asia/Dacca": "Asia/Dhaka",
    "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
    "Europe/Kiev": "Europe/Kyiv",
    "Atlantic/Faeroe": "Atlantic/Faroe",
    "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
    "America/Indianapolis": "America/Indiana/Indianapolis",
    "America/Louisville": "America/Kentucky/Louisville",
    "Pacific/Truk": "Pacific/Chuuk",
    "Pacific/Ponape": "Pacific/Pohnpei",
    "Singapore": "Asia/Singapore",
    "Hongkong": "Asia/Hong_Kong",
    "Japan": "Asia/Tokyo",
}


def main() -> None:
    source = sys.argv[1] if len(sys.argv) > 1 else "/usr/share/zoneinfo/zone.tab"
    table: dict[str, str] = {}
    with open(source) as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            code, _coords, zone = line.split("\t")[:3]
            table[zone.strip()] = code
    for alias, zone in ALIASES.items():
        if zone in table:
            table[alias] = table[zone]
    with open(OUT, "w") as f:
        json.dump(dict(sorted(table.items())), f, separators=(",", ":"))
        f.write("\n")
    print(f"Wrote {os.path.relpath(OUT, ROOT)} ({len(table)} zones, {os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
