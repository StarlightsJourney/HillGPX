#!/usr/bin/env python3
"""
Scrape trail photos from a detail page and attach them to a HillGPX venue.

    python3 scripts/scrape_trail_photos.py "https://www.alltrails.com/trail/..." \
        --venue mount-faber-singapore \
        --name "Mount Faber trail" \
        --max 6 \
        --build

The script launches a stealth Chromium browser, loads a saved session if you
provide one, then:

1. Scrolls the page and tries common gallery / lightbox controls to force lazy
   images into the DOM.
2. Listens to network responses and extracts photo URLs from JSON payloads.
3. Parses the DOM with BeautifulSoup to collect src / data-src / srcset URLs.
4. Scores the collected URLs, drops thumbnails, and downloads the best ones
   asynchronously with httpx.
5. Resizes each image to the same 420 px WebP the site uses and registers the
   best one in data/photos.json.
6. Runs scripts/build_data.py when --build is passed, so the venue card and
   detail page show the new photo.

Only scrape photos you have permission to republish. Most trail platforms forbid
bulk scraping of user-contributed imagery without the photographer's consent.
Use this for photos you took yourself or have explicit permission to share.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
import random
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright, Page, Response

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
PHOTO_DIR = REPO_ROOT / "public" / "photos"
OUT_PATH = REPO_ROOT / "data" / "photos.json"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
VIEWPORT = {"width": 1440, "height": 900}
MAX_WIDTH = 420
WEBP_QUALITY = 72
CONCURRENT_DOWNLOADS = 3


try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install -r scripts/requirements.txt")


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def load_state(path: str | None) -> dict[str, Any] | None:
    if not path or not Path(path).exists():
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def save_photos(photos: dict[str, dict]) -> None:
    """Merge into data/photos.json in the same format fetch_photos.py uses."""
    existing: dict[str, dict] = {}
    if OUT_PATH.exists():
        try:
            with open(OUT_PATH, encoding="utf-8") as fh:
                existing = json.load(fh).get("photos", {})
        except (json.JSONDecodeError, OSError):
            pass
    existing.update(photos)
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    payload = {
        "source": "Mixed — see individual records",
        "licence": "See individual photo records; only redistribute with permission",
        "photos": existing,
    }
    tmp = str(OUT_PATH) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, OUT_PATH)


def clean_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "trail"


def filename_for(venue_slug: str, trail_name: str, index: int) -> str:
    base = clean_name(trail_name) if trail_name else venue_slug
    return f"{base}_{index:02d}.webp"


def resolve_url(base_url: str, href: str | None) -> str | None:
    if not href:
        return None
    href = href.strip()
    if href.startswith("data:") or href.startswith("javascript:") or href.startswith("mailto:"):
        return None
    if href.startswith(("http://", "https://")):
        return href
    return urljoin(base_url, href)


def parse_srcset(srcset: str) -> tuple[str | None, int]:
    """Return the URL with the largest width descriptor from a srcset string."""
    if not srcset:
        return None, 0
    best_url: str | None = None
    best_width = 0
    for part in srcset.split(","):
        pieces = part.strip().split()
        if not pieces:
            continue
        url = pieces[0]
        width = 0
        if len(pieces) > 1:
            descriptor = pieces[-1]
            match = re.search(r"(\d+)", descriptor)
            if match:
                width = int(match.group(1))
        if width > best_width:
            best_url, best_width = url, width
    return best_url, best_width


def is_likely_photo(url: str) -> bool:
    lower = url.lower()
    return lower.endswith((".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif")) and "icon" not in lower


def is_thumbnail(url: str) -> bool:
    lower = url.lower()
    thumb_hints = ["thumb", "thumbnail", "small", "tiny", "avatar", "placeholder", "sprite"]
    return any(hint in lower for hint in thumb_hints) or re.search(r"[?&](w|width|h|height)=\d{1,3}(?:&|$)", lower)


def score_url(url: str) -> int:
    """Higher is better. Prefer large dimensions in URL, avoid thumbnails."""
    lower = url.lower()
    score = 0
    dim_match = re.search(r"[/_-](\d{2,4})[xX](\d{2,4})", lower)
    if dim_match:
        score += int(dim_match.group(1)) + int(dim_match.group(2))
    width_match = re.search(r"[?&]w=(\d+)", lower)
    if width_match:
        score += int(width_match.group(1)) // 2
    if is_thumbnail(url):
        score -= 5000
    if "full" in lower or "original" in lower or "high" in lower:
        score += 1000
    return score


# ---------------------------------------------------------------------------
# Image URL extraction
# ---------------------------------------------------------------------------


async def extract_dom_image_urls(page: Page, base_url: str) -> list[tuple[str, int]]:
    """Parse the current DOM for likely full-resolution photo URLs."""
    html = await page.content()
    soup = BeautifulSoup(html, "html.parser")
    candidates: list[tuple[str, int]] = []

    for img in soup.find_all("img"):
        # Most lazy-loaded galleries store the real image in data-src.
        for attr in ("data-src", "data-lazy-src", "data-original", "data-full-src", "src"):
            url = resolve_url(base_url, img.get(attr))
            if url and is_likely_photo(url):
                candidates.append((url, score_url(url)))

        srcset = img.get("srcset") or img.get("data-srcset")
        url, width = parse_srcset(srcset)
        resolved = resolve_url(base_url, url)
        if resolved and is_likely_photo(resolved):
            candidates.append((resolved, score_url(resolved) + width))

    # Background images on divs are common in galleries.
    for tag in soup.find_all(attrs={"style": True}):
        style = tag["style"]
        for match in re.finditer(r"url\(['\"]?(.*?)['\"]?\)", style):
            url = resolve_url(base_url, match.group(1))
            if url and is_likely_photo(url):
                candidates.append((url, score_url(url)))

    return candidates


def extract_json_photo_urls(data: Any, base_url: str) -> list[tuple[str, int]]:
    """Recursively search JSON for image URLs and geotagged photo records."""
    candidates: list[tuple[str, int]] = []
    if isinstance(data, dict):
        for key, value in data.items():
            if isinstance(value, str) and is_likely_photo(value):
                resolved = resolve_url(base_url, value)
                if resolved:
                    candidates.append((resolved, score_url(resolved) + (50 if "lat" in str(key).lower() else 0)))
            elif isinstance(value, (dict, list)):
                candidates.extend(extract_json_photo_urls(value, base_url))
    elif isinstance(data, list):
        for item in data[:500]:
            if isinstance(item, str) and is_likely_photo(item):
                resolved = resolve_url(base_url, item)
                if resolved:
                    candidates.append((resolved, score_url(resolved)))
            elif isinstance(item, (dict, list)):
                candidates.extend(extract_json_photo_urls(item, base_url))
    return candidates


# ---------------------------------------------------------------------------
# Browser interaction
# ---------------------------------------------------------------------------


def stealth_script() -> str:
    return """
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {} };
    """


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
        ],
    )
    context_kwargs: dict[str, Any] = {
        "user_agent": USER_AGENT,
        "viewport": VIEWPORT,
        "locale": "en-US",
        "timezone_id": "America/New_York",
    }
    state = load_state(args.state)
    if state:
        print(f"Loading saved browser state from {args.state}")
        context_kwargs["storage_state"] = state
    context = await browser.new_context(**context_kwargs)
    await context.add_init_script(stealth_script())
    return browser, context


GALLERY_SELECTORS = [
    "button[aria-label*='photo' i]",
    "button[aria-label*='image' i]",
    "button[aria-label*='gallery' i]",
    "button[aria-label*='next' i]",
    "button[class*='gallery' i]",
    "button[class*='photo' i]",
    "[class*='lightbox'] img",
    "[class*='modal'] img",
    "[class*='gallery'] img",
]


async def interact_with_gallery(page: Page, max_clicks: int = 12) -> None:
    """Click common gallery controls and scroll to render lazy images."""
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    await asyncio.sleep(random.uniform(0.8, 1.5))

    seen_hashes: set[str] = set()
    for _ in range(max_clicks):
        urls = [url for url, _ in await extract_dom_image_urls(page, page.url)]
        current = set(hash(u) for u in urls)
        if current.issubset(seen_hashes):
            break
        seen_hashes.update(current)

        # Try clicking a "next" / gallery button.
        clicked = False
        for selector in GALLERY_SELECTORS[:4]:
            try:
                button = page.locator(selector).first
                if await button.is_visible(timeout=500):
                    await button.click(timeout=2000)
                    clicked = True
                    await asyncio.sleep(random.uniform(0.5, 1.0))
                    break
            except Exception:
                continue
        if not clicked:
            # No button found; scroll a bit more and stop.
            await page.evaluate("window.scrollBy(0, 800)")
            await asyncio.sleep(random.uniform(0.5, 1.0))


# ---------------------------------------------------------------------------
# Download and resize
# ---------------------------------------------------------------------------


async def download_image(
    client: httpx.AsyncClient,
    url: str,
    dest: Path,
    semaphore: asyncio.Semaphore,
) -> bool:
    async with semaphore:
        try:
            await asyncio.sleep(random.uniform(0.5, 1.5))
            response = await client.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if not content_type.startswith("image/") and "image" not in content_type:
                print(f"  skipped {url} (content-type {content_type})")
                return False
            raw = response.content
            if len(raw) < 1024:
                print(f"  skipped {url} (too small)")
                return False
            image = Image.open(io.BytesIO(raw)).convert("RGB")
            if image.width > MAX_WIDTH:
                height = round(image.height * MAX_WIDTH / image.width)
                image = image.resize((MAX_WIDTH, height), Image.LANCZOS)
            dest.parent.mkdir(parents=True, exist_ok=True)
            image.save(dest, "WEBP", quality=WEBP_QUALITY, method=6)
            print(f"  downloaded {dest.name} from {urlparse(url).netloc}")
            return True
        except Exception as exc:
            print(f"  failed {url}: {exc}")
            return False


# ---------------------------------------------------------------------------
# Main scraper
# ---------------------------------------------------------------------------


class TrailPhotoScraper:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.collected: list[tuple[str, int]] = []
        self.network_records: list[dict[str, Any]] = []

    async def run(self) -> list[Path]:
        async with async_playwright() as p:
            browser, context = await launch_context(p, self.args)
            page = await context.new_page()

            async def on_response(response: Response) -> None:
                try:
                    content_type = response.headers.get("content-type", "").lower()
                    if "json" not in content_type:
                        return
                    body = await response.json()
                    urls = extract_json_photo_urls(body, response.url)
                    if urls:
                        self.collected.extend(urls)
                        self.network_records.append({"url": response.url, "count": len(urls)})
                except Exception:
                    pass

            page.on("response", lambda response: asyncio.create_task(on_response(response)))

            print(f"Navigating to {self.args.url}")
            await page.goto(self.args.url, wait_until="networkidle", timeout=self.args.timeout * 1000)
            await asyncio.sleep(random.uniform(1.5, 3.0))
            await interact_with_gallery(page)

            dom_urls = await extract_dom_image_urls(page, page.url)
            self.collected.extend(dom_urls)

            await context.close()
            await browser.close()

        return await self.download_best()

    async def download_best(self) -> list[Path]:
        # Deduplicate, score, keep the top N.
        scored: dict[str, int] = {}
        for url, score in self.collected:
            parsed = urlparse(url)
            # Strip query-string cache busters for dedup while keeping the URL for download.
            key = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
            if key not in scored or score > scored[key]:
                scored[key] = score

        urls = sorted(scored.items(), key=lambda item: item[1], reverse=True)
        urls = urls[: self.args.max]
        if not urls:
            print("No photo URLs found. Try --no-headless and --save-state to log in.")
            return []

        print(f"Found {len(urls)} candidate photo(s); downloading...")
        semaphore = asyncio.Semaphore(CONCURRENT_DOWNLOADS)
        saved: list[Path] = []
        async with httpx.AsyncClient() as client:
            for i, (key, _score) in enumerate(urls, 1):
                dest = PHOTO_DIR / filename_for(self.args.venue, self.args.name, i)
                if await download_image(client, key, dest, semaphore):
                    saved.append(dest)

        return saved


# ---------------------------------------------------------------------------
# Registration & build
# ---------------------------------------------------------------------------


def register_best_photo(paths: list[Path], venue_slug: str, source_url: str, credit: str | None) -> Path | None:
    if not paths:
        return None
    best = paths[0]
    rel = f"photos/{best.name}"
    record = {"file": rel, "sourceUrl": source_url}
    if credit:
        record["creator"] = credit
    save_photos({venue_slug: record})
    print(f"Registered {rel} for venue {venue_slug}")
    return best


def run_build() -> None:
    print("Running scripts/build_data.py")
    result = subprocess.run([sys.executable, "scripts/build_data.py"], cwd=REPO_ROOT)
    if result.returncode != 0:
        sys.exit(f"build_data.py failed with exit code {result.returncode}")
    print("Application dataset rebuilt")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape trail photos from a detail page and attach them to a HillGPX venue."
    )
    parser.add_argument("url", help="Trail detail page URL")
    parser.add_argument("--venue", required=True, help="HillGPX venue slug to attach the photo to")
    parser.add_argument("--name", help="Trail display name (used in filenames)")
    parser.add_argument("--max", type=int, default=6, help="Maximum number of photos to download (default 6)")
    parser.add_argument("--credit", help="Photographer / source credit")
    parser.add_argument("--state", help="Playwright storage-state JSON file to load")
    parser.add_argument("--headless", action=argparse.BooleanOptionalAction, default=True, help="Run browser headlessly")
    parser.add_argument("--build", action="store_true", help="Run scripts/build_data.py afterwards")
    parser.add_argument("--save-state", action="store_true", help="Save the browser session after navigation")
    parser.add_argument("--timeout", type=int, default=60, help="Page navigation timeout in seconds")
    return parser.parse_args(argv)


async def main_async(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.save_state and not args.state:
        args.state = str(REPO_ROOT / "trail-photo-state.json")

    print("=" * 60)
    print("HillGPX trail photo scraper")
    print("=" * 60)
    print("Only scrape photos you have permission to republish.\n")

    scraper = TrailPhotoScraper(args)
    paths = await scraper.run()
    if not paths:
        print("No photos downloaded.")
        return 1

    best = register_best_photo(paths, args.venue, args.url, args.credit)
    if not best:
        print("All downloads failed.")
        return 1

    if args.save_state and args.state:
        async with async_playwright() as p:
            browser, context = await launch_context(p, args)
            await context.storage_state(path=args.state)
            print(f"Saved browser state to {args.state}")
            await context.close()
            await browser.close()

    if args.build:
        run_build()

    print("\nDone. Next: commit data/photos.json and public/photos/")
    return 0


def main() -> int:
    return asyncio.run(main_async())


if __name__ == "__main__":
    sys.exit(main())
