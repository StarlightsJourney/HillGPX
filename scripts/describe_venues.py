#!/usr/bin/env python3
"""
Write the "About this place" text for venue pages with a free-tier LLM.

For each venue it gathers only verifiable inputs — the venue's own facts,
the matching Wikipedia summary (if an article sits at the venue), routes that
pass it, and approved community reviews from Supabase — and asks the model for
a short, plain, Airbnb-style description. Output goes to
public/data/descriptions.json, which the site reads; venues with nothing to
summarise beyond their numbers are skipped (the site writes those itself).

Any OpenAI-compatible endpoint works. First match wins:

  FREELLMAPI_URL + FREELLMAPI_API_KEY   self-hosted FreeLLMAPI gateway (model "auto")
  GROQ_API_KEY                          Groq free tier (GROQ_MODEL, default openai/gpt-oss-120b)
  LLM_BASE_URL + LLM_API_KEY + LLM_MODEL any other provider

Keys are read from the environment or .env.local and never written anywhere.

    python3 scripts/describe_venues.py --limit 50
    python3 scripts/describe_venues.py --slugs bukit-timah-hill,mount-faber
    python3 scripts/describe_venues.py --dry-run      # show prompts, call nothing
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_peaks import ssl_context  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "public", "data", "descriptions.json")
VENUES = os.path.join(ROOT, "public", "data", "venues.json")
ROUTES = os.path.join(ROOT, "public", "data", "routes.json")
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "https://dzpgnebkyubeptitzjlj.supabase.co")
SUPABASE_KEY = os.environ.get("VITE_SUPABASE_KEY", "sb_publishable_invDmVPb4d4aKqTMTRp72w_hpFBZ0AI")
USER_AGENT = "HillGPX/0.3 (open source; https://github.com/StarlightsJourney/HillGPX)"

SYSTEM_PROMPT = """You write the "About this place" line on HillGPX, a free community map of hills, mountains, staircases and tall blocks that people climb to train.

FORMAT (always):
- Exactly two short sentences. 10 to 30 words in total.
- Sentence 1: what the place is. If the input names something iconic there (a famous summit, tower, temple, lake, ridge, landmark, or a record like "highest in Singapore"), name it.
- Sentence 2: one useful fact for someone going there (the climb, the start point, opening hours, the terrain).

STYLE:
- Very simple words that a 10-year-old understands. Short sentences.
- Use only facts in the input. Never invent views, crowds, popularity, distances, times or history.
- Say "elevation" for height above sea level. Say "EG" only for a climb measured bottom to top, such as a stairwell.
- No em dashes or en dashes, no semicolons, no exclamation marks, no emojis, no rhetorical questions.
- Banned words: nestled, boasts, hidden gem, breathtaking, stunning, perfect for, unforgettable, embark, delve, testament, paradise, must-visit, haven, whether.
- Output the two sentences only. No title, list, quotes or preamble."""

BANNED = re.compile(
    r"nestled|boasts|hidden gem|breathtaking|stunning|whether|perfect for|unforgettable|embark|delve|testament|paradise|must-visit|haven|!|—|–|;",
    re.I,
)


def load_env() -> None:
    path = os.path.join(ROOT, ".env.local")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def provider() -> tuple[str, str, str] | None:
    if os.environ.get("FREELLMAPI_URL") and os.environ.get("FREELLMAPI_API_KEY"):
        base = os.environ["FREELLMAPI_URL"].rstrip("/")
        return (base if base.endswith("/v1") else base + "/v1", os.environ["FREELLMAPI_API_KEY"], os.environ.get("FREELLMAPI_MODEL", "auto"))
    if os.environ.get("GROQ_API_KEY"):
        return ("https://api.groq.com/openai/v1", os.environ["GROQ_API_KEY"], os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b"))
    if os.environ.get("LLM_BASE_URL") and os.environ.get("LLM_API_KEY") and os.environ.get("LLM_MODEL"):
        return (os.environ["LLM_BASE_URL"].rstrip("/"), os.environ["LLM_API_KEY"], os.environ["LLM_MODEL"])
    return None


def get_json(url: str, headers: dict | None = None) -> object | None:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    try:
        with urllib.request.urlopen(request, context=ssl_context(), timeout=30) as resp:
            return json.load(resp)
    except Exception as exc:
        print(f"    {urllib.parse.urlparse(url).netloc}: {exc}")
        return None


STOP = re.compile(r"\b(mount|mt|gunung|bukit|bt|pulau|hill|peak|puncak|pico|monte|mont|berg|shan|yama|dake)\b")


def core(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", STOP.sub(" ", re.sub(r"\(.*?\)", " ", name.lower()))).strip()


def wikipedia(venue: dict) -> tuple[str, str] | None:
    geo = get_json(
        "https://en.wikipedia.org/w/api.php?"
        + urllib.parse.urlencode({"action": "query", "list": "geosearch", "gscoord": f"{venue['lat']}|{venue['lng']}", "gsradius": 5000, "gslimit": 20, "format": "json"})
    )
    pages = (geo or {}).get("query", {}).get("geosearch", []) if isinstance(geo, dict) else []
    name = core(venue["name"])
    # The article about the place itself, not an expedition, disaster or list
    # that happens to share its name: exact matches first, then starts-with.
    event = re.compile(r"expedition|disaster|avalanche|earthquake|base camp|list of|in popular culture|accident|crash|battle", re.I)

    def rank(page: dict) -> int:
        title = core(page["title"])
        return 0 if title == name else 1 if title.startswith(name) else 2

    for page in sorted(pages, key=rank):
        title = core(page["title"])
        if event.search(page["title"]):
            continue
        if len(name) >= 3 and len(title) >= 3 and (name in title or title in name):
            summary = get_json(f"https://en.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(page['title'])}")
            if isinstance(summary, dict) and summary.get("extract") and summary.get("type") != "disambiguation":
                return summary["title"], summary["extract"]
    return None


def reviews(slug: str) -> list[dict]:
    data = get_json(
        f"{SUPABASE_URL}/rest/v1/reviews?venue_slug=eq.{urllib.parse.quote(slug)}&select=rating,comment&order=created_at.desc&limit=40",
        {"apikey": SUPABASE_KEY},
    )
    return data if isinstance(data, list) else []


def chat(endpoint: tuple[str, str, str], user: str) -> str:
    base, key, model = endpoint
    body = json.dumps({
        "model": model,
        "temperature": 0.3,
        # gpt-oss reasons before answering; leave room for it and keep it brief.
        "max_tokens": 900,
        **({"reasoning_effort": "low"} if "gpt-oss" in model else {}),
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}],
    }).encode()
    request = urllib.request.Request(
        f"{base}/chat/completions", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, context=ssl_context(), timeout=60) as resp:
        data = json.load(resp)
    return data["choices"][0]["message"]["content"].strip().strip('"')


def facts(venue: dict, routes: list[dict]) -> str:
    kind = {"hill": "hill or mountain", "hdb_block": "residential tower block climbed by its stairwell", "stairs": "public staircase"}.get(venue["type"], venue["type"])
    lines = [f"Name: {venue['name']}", f"Kind: {kind}", f"Coordinates: {venue['lat']:.4f}, {venue['lng']:.4f}"]
    if venue["type"] == "hill" and venue.get("summitM") is not None:
        lines.append(f"Elevation (above sea level): {venue['summitM']} m")
    if venue.get("gainM") is not None and venue["type"] != "hill":
        lines.append(f"EG bottom to top: {venue['gainM']} m")
    if venue.get("storeys"):
        lines.append(f"Storeys: {venue['storeys']}")
    if venue.get("country"):
        lines.append(f"Country (ISO code, write the full name): {venue['country']}")
    if venue.get("notes") and not venue["notes"].startswith("Summit elevation from"):
        lines.append(f"Notes: {venue['notes']}")
    for route in routes[:3]:
        lines.append(f"Shared route: {route['name']}, {route['distanceM'] / 1000:.1f} km, {round(route['gainM'])} m EG")
    return "\n".join(lines)


def world_summits() -> list[dict]:
    """The summits the landing page shows first: the tallest dozen per country in the peak index."""
    path = os.path.join(ROOT, "public", "data", "peaks", "index.json")
    with open(path, encoding="utf-8") as fh:
        index = json.load(fh)
    tile = index["tile"]
    by_country: dict[str, list] = {}
    for row in index["top"]:
        by_country.setdefault(row[6], []).append(row)

    def tok(n: int) -> str:
        return f"m{-n}" if n < 0 else str(n)

    out = []
    for code, rows in by_country.items():
        for row in sorted(rows, key=lambda r: -r[4])[:12]:
            south, west = int((row[2] // tile) * tile), int((row[3] // tile) * tile)
            out.append({
                "slug": f"gn{row[0]}-{tok(south)}x{tok(west)}", "name": row[1], "type": "hill",
                "summitM": row[4], "lat": row[2], "lng": row[3], "country": code, "routeSlugs": [],
            })
    return out


def main(args: argparse.Namespace) -> None:
    load_env()
    endpoint = provider()
    if not endpoint and not args.dry_run:
        raise SystemExit(
            "No LLM key found. Add GROQ_API_KEY (free at console.groq.com) or FREELLMAPI_URL + FREELLMAPI_API_KEY "
            "to .env.local, or pass --dry-run."
        )
    with open(VENUES, encoding="utf-8") as fh:
        venues = json.load(fh)["venues"]
    with open(ROUTES, encoding="utf-8") as fh:
        all_routes = json.load(fh)["routes"]
    existing = {"descriptions": {}}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as fh:
            existing = json.load(fh)
    out: dict = existing.get("descriptions", {})

    wanted = set(args.slugs.split(",")) if args.slugs else None
    if args.world:
        venues = venues + world_summits()
    candidates = [v for v in venues if (v["slug"] in wanted if wanted else v["type"] != "hdb_block" or v.get("routeSlugs"))]
    candidates.sort(key=lambda v: (-len(v.get("routeSlugs", [])), -(v.get("summitM") or v.get("gainM") or 0)))

    def save() -> None:
        if args.dry_run:
            return
        payload = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "model": endpoint[2] if endpoint else None,
            "note": "Generated by scripts/describe_venues.py from Wikipedia and community reviews. Edit the inputs, not this file.",
            "descriptions": out,
        }
        with open(OUT, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=1)

    written = 0
    for venue in candidates:
        if written >= args.limit:
            break
        routes = [r for r in all_routes if r["slug"] in venue.get("routeSlugs", [])]
        wiki = wikipedia(venue)
        venue_reviews = [r for r in reviews(venue["slug"]) if r.get("comment")]
        if not wiki and not venue_reviews and not wanted and not args.facts_ok:
            continue
        parts = [facts(venue, routes)]
        sources = []
        if wiki:
            parts.append(f"Wikipedia ({wiki[0]}):\n{wiki[1]}")
            sources.append("Wikipedia")
        if venue_reviews:
            parts.append("Community reviews:\n" + "\n".join(f"- {r['rating']}/5: {r['comment']}" for r in venue_reviews[:20]))
            sources.append(f"{len(venue_reviews)} community review{'s' if len(venue_reviews) != 1 else ''}")
        prompt = "\n\n".join(parts)
        digest = hashlib.sha1(prompt.encode()).hexdigest()[:12]
        if out.get(venue["slug"], {}).get("inputHash") == digest and not args.force:
            continue
        print(f"{venue['slug']}  ({', '.join(sources) or 'facts only'})")
        if args.dry_run:
            print(prompt, "\n")
            written += 1
            continue
        text = ""
        for _ in range(2):
            try:
                text = chat(endpoint, prompt)  # type: ignore[arg-type]
            except Exception as exc:
                print(f"    model error: {exc}")
                time.sleep(5)
                continue
            if not BANNED.search(text) and 6 <= len(text.split()) <= 34 and text.count('.') <= 3:
                break
            print("    rejected (style rules); retrying")
            text = ""
        if not text:
            continue
        out[venue["slug"]] = {"text": text, "sources": sources or ["HillGPX data"], "inputHash": digest}
        written += 1
        if written % 10 == 0:
            save()
        time.sleep(args.pause)

    save()
    print(f"{written} description(s) {'previewed' if args.dry_run else 'written'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate venue descriptions with a free-tier LLM")
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--slugs", help="Comma-separated venue slugs to (re)describe")
    parser.add_argument("--force", action="store_true", help="Regenerate even when inputs are unchanged")
    parser.add_argument("--dry-run", action="store_true", help="Print prompts without calling a model")
    parser.add_argument("--world", action="store_true", help="Also describe the landing's highest summits in every country")
    parser.add_argument("--facts-ok", action="store_true", help="Describe places with no Wikipedia article from their facts alone")
    parser.add_argument("--pause", type=float, default=2.5, help="Seconds between requests (free-tier rate limits)")
    main(parser.parse_args())
