#!/usr/bin/env python3
"""Fetch open-licence trail and mountain photos from Wikimedia Commons and Flickr.

Examples:
    python3 scripts/fetch_open_photos.py --venue mount-faber-singapore --limit 3 --build
    python3 scripts/fetch_open_photos.py --lat 1.273 --lon 103.817 --radius 500 --dry-run
    python3 scripts/fetch_open_photos.py --batch --type hill --max-venues 50 --per-venue 3 --build

Original downloads and complete attribution metadata are kept in the ignored
open_trail_media/ directory. Only resized WebP derivatives are registered with
the app.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import html
import io
import json
import math
import mimetypes
import os
import re
import ssl
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlparse

import aiofiles
import aiohttp
import certifi
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
PHOTO_DIR = REPO_ROOT / "public" / "photos" / "open"
ORIGINAL_DIR = REPO_ROOT / "open_trail_media"
METADATA_PATH = ORIGINAL_DIR / "metadata.json"
SEARCH_LOG_PATH = SCRIPT_DIR / ".cache" / "open_photos_searched.json"
PHOTOS_JSON = REPO_ROOT / "data" / "photos.json"
VENUES_JSON = REPO_ROOT / "public" / "data" / "venues.json"

USER_AGENT = f"HillGPX/0.3 (https://github.com/StarlightsJourney/HillGPX; open photo pipeline) aiohttp/{aiohttp.__version__}"
MAX_WIDTH = 420
WEBP_QUALITY = 72
VENUE_CONCURRENCY = 2
API_REQUEST_PAUSE_S = 0.5
API_REQUEST_LOCK = asyncio.Lock()
LAST_API_REQUEST = 0.0
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp"}
TITLE_REJECT = re.compile(
    r"(?i)\b(map|logo|diagram|sign(?:[ -]?board)?|notice(?:[ -]?board)?|information board|"
    r"plan|chart|locator|icon|flag|coat of arms|marker|plaque|boundary|monument|memorial|"
    r"triangulation stone|summit stone|trig point|benchmark|milestone|trailhead)\b"
    r"|\b\d{2}[-/]\d{2}[-/]\d{4}\s*\(\d+\)|\b(?:img|image)\s*\d+\b"
    r"|\b(summit|peak)\s*-\s*panoramio\b|\bISS\d*\b|\bview of earth\b"
)
COMMONS_LICENSE_PATTERN = re.compile(
    r"^(cc-by(-sa)?(-\d(\.\d)?)?\b.*|cc0.*|public-domain.*|pd(-.*)?)$"
)
IRRELEVANT_TITLE = re.compile(
    r"(?i)\b(ISS\d+|view of earth|DVIDS(HUB)?|archival|negative number|page \d+|USS |cave|"
    r"stupa|temple|logo|services|orangutans?|primates|mammals|wildlife)\b"
)
NONLANDSCAPE_TITLE = re.compile(
    r"(?i)\b(flowers?|plants?|flora|fauna|insects?|birds?|animals?|fungi|herbs?|"
    r"edelweis(?:s)?|bunga|bats?|kelelawar|goa|gua|carte|atlas|bridge|bridges|"
    r"historical|historic|heritage|ruins?|old site|route\s+\d+|rue|streets?|avenues?|"
    r"boulevards?|paris|soldier|tomb|portrait|headshot)\b|[橋桥]"
)
TAXON_TITLE = re.compile(
    r"^[A-Z][a-z]+ (x )?[a-z]{3,}( (ssp|subsp|var)\.? [a-z]+)?( [a-z]+)?( \(?\d+\)?)?\.(jpe?g|JPE?G)$"
)
TAXON_BINOMIAL_TITLE = re.compile(
    r"^[A-Z][a-z]+ [a-z]{3,}(?:\s+\(?\d+\)?)?(?:\.(?:jpe?g|webp))?$"
)
TAXON_BINOMIAL_PREFIX = re.compile(r"^[A-Z][a-z]+ [a-z]{3,}(?:\s|$)")
TAXON_MULTI_BINOMIAL = re.compile(r"^[A-Z][a-z]+ [a-z]{3,} (?:and|with) [A-Z][a-z]+ [a-z]{3,}")
TAXON_CONTEXT_TITLE = re.compile(
    r"^[A-Z][a-z]+ [a-z]{3,}(?:\s+\d|\s*\(|\s*,|\s+(?:and|near|ssp|subsp|var)\b)"
)
TAXON_CLOSEUP_TITLE = re.compile(
    r"(?i)^[A-Z][a-z]+ [a-z]+ .*\b(flowers?|branches?|leaves|pistillate|staminate)\b"
)
CATEGORY_REJECT = re.compile(
    r"(?i)(taxon|flora of|fauna of|plants|insects|birds|animals|fungi|iNaturalist|"
    r"photographs by ISS|ISS expedition|ships|people|portraits|books|scanned|archaeolog|"
    r"bridges|historic sites|cultural heritage|mammals|primates|orangutans?|wildlife|"
    r"torii|shrines?|shinto|sengen-taisha)"
)
PERSON_TITLE = re.compile(
    r"^(?:(?:19|20)\d{2}\s+[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+\d+)?|"
    r"[A-Z][a-z]+\s+[A-Z][a-z]+\s+(?:19|20)\d{2})(?:\s+\(\d+\))?\.(?:jpe?g)$"
)
LANDSCAPE_KEYWORD = re.compile(
    r"(?i)(summit|peak|mount|mt\.?|mountain|hill|ridge|trail|hiking|trek|view|panorama|"
    r"panoramio|sunrise|sunset|cirque|valley|volcano|crater|gunung|bukit|doi |puncak|"
    r"山|峰|岳|嶺|岭|nui|núi|landscape|scenery|climb)"
)
PLACE_WORDS = {"mount", "mt", "gunung", "doi", "bukit", "shan", "peak", "山"}

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install -r scripts/requirements.txt")

sys.path.insert(0, str(SCRIPT_DIR))
from import_gpx import read_env_token  # noqa: E402


@dataclass
class PhotoRecord:
    source: str
    title: str
    page_url: str
    original_url: str
    download_url: str
    original_width: int | None
    original_height: int | None
    local_original: str | None
    site_file: str | None
    artist: str | None
    license: str
    license_url: str | None
    usage_terms: str | None
    date_taken: str | None
    description: str | None
    lat: float | None
    lon: float | None
    distance_m: float | None
    venue_slug: str | None
    fetched_at: str | None
    categories: list[str] = field(default_factory=list)


class RetryableHTTPError(Exception):
    """An HTTP response status that is safe to retry."""


@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type((RetryableHTTPError, aiohttp.ClientConnectionError, asyncio.TimeoutError)),
    reraise=True,
)
async def fetch_json(
    session: aiohttp.ClientSession,
    url: str,
    params: dict[str, Any] | None = None,
) -> Any:
    global LAST_API_REQUEST
    async with API_REQUEST_LOCK:
        elapsed = time.monotonic() - LAST_API_REQUEST
        if elapsed < API_REQUEST_PAUSE_S:
            await asyncio.sleep(API_REQUEST_PAUSE_S - elapsed)
        LAST_API_REQUEST = time.monotonic()
    async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=30)) as response:
        if response.status in RETRYABLE_STATUS_CODES:
            retry_after = response.headers.get("Retry-After")
            if retry_after:
                try:
                    await asyncio.sleep(min(int(retry_after), 60))
                except ValueError:
                    pass
            raise RetryableHTTPError(f"HTTP {response.status} from {url}")
        response.raise_for_status()
        return await response.json()


@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type((RetryableHTTPError, aiohttp.ClientConnectionError, asyncio.TimeoutError)),
    reraise=True,
)
async def fetch_bytes(session: aiohttp.ClientSession, url: str) -> bytes:
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=60)) as response:
        if response.status in RETRYABLE_STATUS_CODES:
            retry_after = response.headers.get("Retry-After")
            if retry_after:
                try:
                    await asyncio.sleep(min(int(retry_after), 60))
                except ValueError:
                    pass
            raise RetryableHTTPError(f"HTTP {response.status} from {url}")
        response.raise_for_status()
        return await response.read()


def ssl_context() -> ssl.SSLContext:
    return ssl.create_default_context(cafile=certifi.where())


def clean_html(text: str | None) -> str | None:
    if not text:
        return None
    cleaned = html.unescape(re.sub(r"<[^>]+>", "", text))
    return re.sub(r"\s+", " ", cleaned).strip() or None


def metadata_value(metadata: Mapping[str, Any], key: str) -> str | None:
    value = metadata.get(key)
    if isinstance(value, Mapping):
        value = value.get("value")
    return clean_html(value) if isinstance(value, str) else None


def commons_license_ok(short_name: str | None) -> bool:
    if not short_name:
        return False
    normalized = re.sub(r"[ _]+", "-", short_name.strip().lower())
    if "-nc" in normalized or "-nd" in normalized:
        return False
    return COMMONS_LICENSE_PATTERN.fullmatch(normalized) is not None


def haversine_m(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    earth_radius_m = 6_371_008.8
    d_lat = math.radians(b_lat - a_lat)
    d_lon = math.radians(b_lon - a_lon)
    value = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lon / 2) ** 2
    )
    return 2 * earth_radius_m * math.asin(math.sqrt(value))


def commons_categories(page: Mapping[str, Any]) -> list[str]:
    categories = page.get("categories", [])
    if not isinstance(categories, list):
        return []
    return [
        str(category["title"]).removeprefix("Category:")
        for category in categories
        if isinstance(category, Mapping) and category.get("title")
    ]


def candidate_is_rejected(record: PhotoRecord) -> bool:
    title = record.title.replace("_", " ")
    extension = Path(urlparse(record.original_url).path).suffix.casefold()
    title_extension = Path(title).suffix.casefold()
    if extension in {".png", ".gif", ".svg"} or title_extension in {".png", ".gif", ".svg"}:
        return True
    if (
        TITLE_REJECT.search(title)
        or IRRELEVANT_TITLE.search(title)
        or NONLANDSCAPE_TITLE.search(title)
        or (
            PERSON_TITLE.fullmatch(title)
            and LANDSCAPE_KEYWORD.search(normalized_name(title)) is None
        )
    ):
        return True
    if (
        TAXON_TITLE.fullmatch(title)
        or TAXON_BINOMIAL_TITLE.fullmatch(title)
        or TAXON_BINOMIAL_PREFIX.match(title)
        or TAXON_MULTI_BINOMIAL.match(title)
        or TAXON_CONTEXT_TITLE.match(title)
        or TAXON_CLOSEUP_TITLE.search(title)
    ):
        return True
    return any(CATEGORY_REJECT.search(category) for category in record.categories)


def normalized_name(value: str) -> str:
    return re.sub(r"[^\w]+", " ", value.casefold()).strip()


def place_name_variants(value: str) -> set[str]:
    words = normalized_name(value).split()
    if not words:
        return set()
    variants: set[str] = set()
    start, end = 0, len(words)
    while start < end:
        variants.add(" ".join(words[start:end]))
        if words[start] in PLACE_WORDS:
            start += 1
        elif words[end - 1] in PLACE_WORDS:
            end -= 1
        else:
            break
    without_place_words = " ".join(word for word in words if word not in PLACE_WORDS)
    if without_place_words:
        variants.add(without_place_words)
    for index, word in enumerate(words):
        if word in PLACE_WORDS:
            variants.add(" ".join(words[index + 1 :]))
            variants.add(" ".join(words[:index]))
    return {variant for variant in variants if variant}


def venue_name_terms(venue_name: str, venue_slug: str | None) -> set[str]:
    terms = place_name_variants(venue_name)
    if venue_slug:
        slug_parts = [
            part for part in venue_slug.split("-")
            if part and not part.isdigit()
        ]
        if slug_parts:
            terms.update(place_name_variants(" ".join(slug_parts)))
    return {term for term in terms if term}


def candidate_is_relevant(record: PhotoRecord, venue_name: str, venue_slug: str | None) -> bool:
    if candidate_is_rejected(record):
        return False
    content = normalized_name(" ".join((record.title, record.description or "", *record.categories)))
    for term in venue_name_terms(venue_name, venue_slug):
        if re.search(rf"(?<!\w){re.escape(term)}(?!\w)", content):
            return True
    return LANDSCAPE_KEYWORD.search(content) is not None


def page_coordinates(page: Mapping[str, Any], info: Mapping[str, Any]) -> tuple[float | None, float | None]:
    coordinates = page.get("coordinates") or info.get("coordinates")
    if isinstance(coordinates, list) and coordinates:
        coordinates = coordinates[0]
    if isinstance(coordinates, Mapping):
        try:
            return float(coordinates["lat"]), float(coordinates["lon"])
        except (KeyError, TypeError, ValueError):
            pass
    extmetadata = info.get("extmetadata", {})
    if isinstance(extmetadata, Mapping):
        try:
            lat = float(metadata_value(extmetadata, "GPSLatitude") or "")
            lon = float(metadata_value(extmetadata, "GPSLongitude") or "")
            return lat, lon
        except (TypeError, ValueError):
            pass
    return None, None


def parse_commons_pages(
    pages: Mapping[str, Any],
    venue_lat: float,
    venue_lon: float,
    venue_name: str | None,
) -> list[PhotoRecord]:
    """Convert Commons query pages to eligible photo records without networking."""
    records: list[PhotoRecord] = []
    for page in pages.values():
        if not isinstance(page, Mapping):
            continue
        info_list = page.get("imageinfo", [])
        if not isinstance(info_list, list) or not info_list:
            continue
        info = info_list[0]
        if not isinstance(info, Mapping):
            continue
        extmetadata = info.get("extmetadata", {})
        if not isinstance(extmetadata, Mapping):
            extmetadata = {}
        license_name = metadata_value(extmetadata, "LicenseShortName")
        if not commons_license_ok(license_name):
            continue
        mime = str(info.get("mime", "")).lower()
        width, height = info.get("width"), info.get("height")
        if mime not in IMAGE_MIMES or not isinstance(width, int) or width < 800:
            continue
        title = str(page.get("title", "")).removeprefix("File:")
        if not title:
            continue
        categories = commons_categories(page)
        original_url = info.get("url")
        if not isinstance(original_url, str) or not original_url:
            continue
        description = metadata_value(extmetadata, "ImageDescription")
        description = description[:300] if description else None
        lat, lon = page_coordinates(page, info)
        distance = haversine_m(venue_lat, venue_lon, lat, lon) if lat is not None and lon is not None else None
        download_url = info.get("thumburl") or original_url
        if not isinstance(download_url, str):
            download_url = original_url
        page_url = info.get("descriptionurl") or f"https://commons.wikimedia.org/wiki/{page.get('title', '')}"
        date_taken = metadata_value(extmetadata, "DateTimeOriginal") or metadata_value(extmetadata, "DateTime")
        record = PhotoRecord(
            source="Wikimedia Commons",
            title=title,
            page_url=str(page_url),
            original_url=original_url,
            download_url=download_url,
            original_width=width,
            original_height=height if isinstance(height, int) else None,
            local_original=None,
            site_file=None,
            artist=metadata_value(extmetadata, "Artist"),
            license=license_name or "",
            license_url=metadata_value(extmetadata, "LicenseUrl"),
            usage_terms=metadata_value(extmetadata, "UsageTerms"),
            date_taken=date_taken,
            description=description,
            lat=lat,
            lon=lon,
            distance_m=distance,
            venue_slug=None,
            fetched_at=None,
            categories=categories,
        )
        if not candidate_is_rejected(record):
            records.append(record)
    return records


COMMONS_API = "https://commons.wikimedia.org/w/api.php"
FLICKR_API = "https://api.flickr.com/services/rest/"
FLICKR_OPEN_LICENSE_IDS = "4,5,9,10"
FLICKR_LICENSE_MAP: dict[str, tuple[str, str]] = {
    "4": ("CC BY 2.0", "https://creativecommons.org/licenses/by/2.0/"),
    "5": ("CC BY-SA 2.0", "https://creativecommons.org/licenses/by-sa/2.0/"),
    "9": ("CC0", "https://creativecommons.org/publicdomain/zero/1.0/"),
    "10": ("Public Domain Mark", "https://creativecommons.org/publicdomain/mark/1.0/"),
}


def commons_query_props(limit: int) -> dict[str, Any]:
    return {
        "action": "query",
        "prop": "imageinfo|coordinates|categories",
        "cllimit": "max",
        "clshow": "!hidden",
        "iiprop": "url|extmetadata|size|mime|commonmetadata",
        "iiurlwidth": 1280,
        "format": "json",
        "generator": "search",
        "gsrnamespace": 6,
        "gsrlimit": min(max(limit * 3, 15), 50),
    }


async def search_commons(
    session: aiohttp.ClientSession,
    lat: float,
    lon: float,
    radius: int,
    limit: int,
    venue_name: str | None,
    original: bool = False,
    name_search: bool = True,
    venue_slug: str | None = None,
) -> list[PhotoRecord]:
    params = commons_query_props(limit)
    params.update(
        {
            "generator": "geosearch",
            "ggscoord": f"{lat}|{lon}",
            "ggsradius": radius,
            "ggslimit": min(max(limit * 3, 15), 50),
            "ggsnamespace": 6,
        }
    )
    geosearch_error: Exception | None = None
    try:
        data = await fetch_json(session, COMMONS_API, params)
        pages = data.get("query", {}).get("pages", {})
        records = parse_commons_pages(pages, lat, lon, venue_name)
        records = [
            record for record in records
            if candidate_is_relevant(record, venue_name or "", venue_slug)
        ]
    except Exception as exc:
        geosearch_error = exc
        records = []
    if records or not name_search or not venue_name:
        if geosearch_error and not records:
            raise geosearch_error
        return select_download_url(records, original)

    name_params = commons_query_props(limit)
    name_params["gsrsearch"] = f'"{venue_name}" filetype:bitmap'
    try:
        data = await fetch_json(session, COMMONS_API, name_params)
        pages = data.get("query", {}).get("pages", {})
        records = parse_commons_pages(pages, lat, lon, venue_name)
        records = [
            record for record in records
            if commons_name_search_eligible(record, venue_name, radius, venue_slug)
        ]
    except Exception:
        if geosearch_error:
            raise geosearch_error
        raise
    if not records and geosearch_error:
        raise geosearch_error
    return select_download_url(records, original)


def select_download_url(records: list[PhotoRecord], original: bool) -> list[PhotoRecord]:
    if not original:
        return records
    return [PhotoRecord(**{**asdict(record), "download_url": record.original_url}) for record in records]


def flickr_dimensions(photo: Mapping[str, Any]) -> tuple[int | None, int | None]:
    for suffix in ("o", "l", "c", "z"):
        try:
            width = int(photo.get(f"width_{suffix}", 0))
            height = int(photo.get(f"height_{suffix}", 0))
        except (TypeError, ValueError):
            continue
        if width:
            return width, height or None
    return None, None


async def search_flickr(
    session: aiohttp.ClientSession,
    api_key: str,
    lat: float,
    lon: float,
    radius: int,
    limit: int,
    venue_name: str = "",
    venue_slug: str | None = None,
) -> list[PhotoRecord]:
    radius_km = min(32.0, radius / 1000.0)
    delta = radius_km / 111.0
    params = {
        "method": "flickr.photos.search",
        "api_key": api_key,
        "bbox": f"{lon-delta},{lat-delta},{lon+delta},{lat+delta}",
        "has_geo": 1,
        "license": FLICKR_OPEN_LICENSE_IDS,
        "sort": "interestingness-desc",
        "per_page": min(limit * 3, 50),
        "format": "json",
        "nojsoncallback": 1,
        "extras": "license,owner_name,url_o,url_l,url_c,url_z,o_dims,geo,date_taken,description",
    }
    data = await fetch_json(session, FLICKR_API, params)
    photos = data.get("photos", {}).get("photo", [])
    records: list[PhotoRecord] = []
    for photo in photos:
        if not isinstance(photo, Mapping):
            continue
        license_id = str(photo.get("license", ""))
        license_info = FLICKR_LICENSE_MAP.get(license_id)
        if not license_info:
            continue
        original_url = photo.get("url_o") or photo.get("url_l") or photo.get("url_c") or photo.get("url_z")
        if not isinstance(original_url, str) or not original_url:
            continue
        mime = mimetypes.guess_type(urlparse(original_url).path)[0]
        if mime not in IMAGE_MIMES:
            continue
        width, height = flickr_dimensions(photo)
        if width is None or width < 800:
            continue
        try:
            photo_lat = float(photo["latitude"]) if photo.get("latitude") not in (None, "") else None
            photo_lon = float(photo["longitude"]) if photo.get("longitude") not in (None, "") else None
        except (TypeError, ValueError):
            photo_lat, photo_lon = None, None
        distance = haversine_m(lat, lon, photo_lat, photo_lon) if photo_lat is not None and photo_lon is not None else None
        title = str(photo.get("title", ""))
        description_value = photo.get("description")
        if isinstance(description_value, Mapping):
            description_value = description_value.get("_content")
        description = clean_html(description_value) if isinstance(description_value, str) else None
        description = description[:300] if description else None
        owner = str(photo.get("owner", ""))
        photo_id = str(photo.get("id", ""))
        page_url = f"https://www.flickr.com/photos/{owner}/{photo_id}/"
        record = PhotoRecord(
            source="Flickr",
            title=title,
            page_url=page_url,
            original_url=original_url,
            download_url=original_url,
            original_width=width,
            original_height=height,
            local_original=None,
            site_file=None,
            artist=photo.get("ownername") or owner or None,
            license=license_info[0],
            license_url=license_info[1],
            usage_terms=license_info[0],
            date_taken=clean_html(photo.get("datetaken")),
            description=description,
            lat=photo_lat,
            lon=photo_lon,
            distance_m=distance,
            venue_slug=None,
            fetched_at=None,
        )
        if candidate_is_relevant(record, venue_name, venue_slug):
            records.append(record)
    return records


def safe_filename(base: str) -> str:
    return re.sub(r"[^a-z0-9_]+", "_", base.lower()).strip("_") or "photo"


def file_extension(url: str, image_format: str) -> str:
    extension = Path(urlparse(url).path).suffix.lower()
    if extension in {".jpg", ".jpeg", ".png", ".webp"}:
        return extension
    return {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}.get(image_format.upper(), ".jpg")


def photo_stem(record: PhotoRecord, index: int) -> str:
    title = safe_filename(record.title)[:48].strip("_") or f"photo_{index:03d}"
    url_hash = hashlib.sha1(record.original_url.encode("utf-8")).hexdigest()[:10]
    return f"{title}_{url_hash}"


async def write_bytes_atomic(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    async with aiofiles.open(temporary, "wb") as handle:
        await handle.write(content)
    os.replace(temporary, path)


async def download_photo(
    session: aiohttp.ClientSession,
    record: PhotoRecord,
    index: int,
    venue_slug: str | None,
) -> PhotoRecord | None:
    try:
        await asyncio.sleep(API_REQUEST_PAUSE_S)
        raw = await fetch_bytes(session, record.download_url)
        if len(raw) < 2048:
            print(f"  skipped {record.title[:60]}: download too small")
            return None
        image = Image.open(io.BytesIO(raw))
        image_format = str(image.format or "").upper()
        if image_format not in {"JPEG", "PNG", "WEBP"} or image.width < 800:
            print(f"  skipped {record.title[:60]}: unsupported image or width below 800 px")
            return None
        actual_width, actual_height = image.size
        derivative = image.convert("RGB")
        if derivative.width > MAX_WIDTH:
            resized_height = round(derivative.height * MAX_WIDTH / derivative.width)
            derivative = derivative.resize((MAX_WIDTH, resized_height), Image.Resampling.LANCZOS)

        stem = photo_stem(record, index)
        folder = safe_filename(venue_slug or "adhoc")
        extension = file_extension(record.download_url, image_format)
        original_path = ORIGINAL_DIR / folder / f"{stem}{extension}"
        site_path = PHOTO_DIR / f"{stem}.webp"
        await write_bytes_atomic(original_path, raw)
        output = io.BytesIO()
        derivative.save(output, "WEBP", quality=WEBP_QUALITY, method=6)
        await write_bytes_atomic(site_path, output.getvalue())
        return PhotoRecord(
            **{
                **asdict(record),
                "local_original": original_path.relative_to(REPO_ROOT).as_posix(),
                "site_file": site_path.relative_to(REPO_ROOT / "public").as_posix(),
                "original_width": record.original_width or actual_width,
                "original_height": record.original_height or actual_height,
                "venue_slug": venue_slug,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    except Exception as exc:
        print(f"  failed {record.title[:60]}: {exc}")
        return None


async def load_metadata() -> list[dict[str, Any]]:
    if not METADATA_PATH.exists():
        return []
    async with aiofiles.open(METADATA_PATH, encoding="utf-8") as handle:
        payload = json.loads(await handle.read())
    return payload if isinstance(payload, list) else []


async def write_metadata(records: list[dict[str, Any]]) -> None:
    ORIGINAL_DIR.mkdir(parents=True, exist_ok=True)
    temporary = METADATA_PATH.with_suffix(".tmp")
    async with aiofiles.open(temporary, "w", encoding="utf-8") as handle:
        await handle.write(json.dumps(records, indent=2, ensure_ascii=False))
    os.replace(temporary, METADATA_PATH)


async def save_metadata(records: list[PhotoRecord]) -> None:
    merged: dict[str, dict[str, Any]] = {}
    for item in await load_metadata():
        original_url = item.get("original_url")
        if original_url:
            merged[str(original_url)] = item
    for record in records:
        item = asdict(record)
        item.pop("categories", None)
        item["registered"] = False
        merged[record.original_url] = item
    await write_metadata(list(merged.values()))


async def sync_metadata_registration() -> None:
    metadata = await load_metadata()
    registered_files = {
        photo.get("file")
        for entry in load_photos_json().values()
        for photo in venue_photo_items(entry)
        if is_open_photo(photo) and isinstance(photo.get("file"), str)
    }
    for record in metadata:
        record["registered"] = record.get("site_file") in registered_files
    await write_metadata(metadata)


def load_photos_document() -> dict[str, Any]:
    if not PHOTOS_JSON.exists():
        return {"photos": {}}
    with open(PHOTOS_JSON, encoding="utf-8") as handle:
        document = json.load(handle)
    if not isinstance(document, dict):
        raise ValueError("data/photos.json must contain an object")
    return document


def load_photos_json() -> dict[str, dict[str, Any]]:
    photos = load_photos_document().get("photos", {})
    return photos if isinstance(photos, dict) else {}


def write_photos_document(document: dict[str, Any]) -> None:
    temporary = PHOTOS_JSON.with_suffix(".tmp")
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(document, handle, separators=(",", ":"), ensure_ascii=False)
    os.replace(temporary, PHOTOS_JSON)


def save_photos_json(mapping: dict[str, dict[str, Any]]) -> None:
    document = load_photos_document()
    existing = document.get("photos", {})
    if not isinstance(existing, dict):
        existing = {}
    existing.update(mapping)
    document["photos"] = existing
    write_photos_document(document)


def is_open_photo(photo: Any) -> bool:
    return isinstance(photo, Mapping) and (
        photo.get("source") in {"Wikimedia Commons", "Flickr"}
        or str(photo.get("file", "")).startswith("photos/open/")
    )


def venue_photo_items(entry: Any) -> list[Mapping[str, Any]]:
    if not isinstance(entry, Mapping):
        return []
    items: list[Mapping[str, Any]] = []
    if entry.get("file"):
        items.append(entry)
    more = entry.get("more")
    if isinstance(more, list):
        items.extend(item for item in more if isinstance(item, Mapping) and item.get("file"))
    return items


def open_photo_count(entry: Any) -> int:
    return sum(1 for photo in venue_photo_items(entry) if is_open_photo(photo))


def photos_needed(entry: Any, per_venue: int) -> int:
    return max(0, per_venue - open_photo_count(entry))


def registered_photo_urls(
    slug: str,
    entry: Any,
    metadata: list[dict[str, Any]],
) -> set[str]:
    page_urls = {
        str(photo["sourceUrl"])
        for photo in venue_photo_items(entry)
        if is_open_photo(photo) and photo.get("sourceUrl")
    }
    urls = set(page_urls)
    urls.update(
        str(record["original_url"])
        for record in metadata
        if record.get("venue_slug") == slug and record.get("page_url") in page_urls and record.get("original_url")
    )
    return urls


def merge_open_photo_entry(
    existing: Any,
    additions: list[dict[str, str]],
    per_venue: int,
    overwrite: bool = False,
) -> dict[str, Any]:
    entry = dict(existing) if isinstance(existing, Mapping) else {}
    primary_is_open = is_open_photo(entry) and entry.get("file")
    if overwrite and primary_is_open:
        entry = {}
        primary_is_open = False
    existing_more = entry.get("more", [])
    more = list(existing_more) if isinstance(existing_more, list) else []
    if primary_is_open:
        primary = {key: value for key, value in entry.items() if key != "more"}
        kept_more = [photo for photo in more if isinstance(photo, Mapping) and photo.get("file")]
        open_count = open_photo_count({"file": primary.get("file"), "source": primary.get("source"), "more": kept_more})
        for photo in additions:
            if open_count >= per_venue or len(kept_more) >= 2:
                break
            kept_more.append(photo)
            open_count += 1
    elif entry.get("file"):
        primary = {key: value for key, value in entry.items() if key != "more"}
        kept_more = [photo for photo in more if isinstance(photo, Mapping) and photo.get("file")]
        open_count = sum(1 for photo in kept_more if is_open_photo(photo))
        for photo in additions:
            if open_count >= per_venue or len(kept_more) >= 2:
                break
            kept_more.append(photo)
            open_count += 1
    else:
        additions = additions[:per_venue]
        if not additions:
            return entry
        primary = additions[0]
        kept_more = additions[1:3]
    if kept_more:
        primary["more"] = kept_more[:2]
    else:
        primary.pop("more", None)
    return primary


def list_open_photos() -> list[tuple[str, str, str]]:
    return sorted(
        (
            str(slug),
            str(photo.get("title", "")),
            str(photo.get("license", "")),
        )
        for slug, entry in load_photos_json().items()
        for photo in venue_photo_items(entry)
        if is_open_photo(photo)
    )


def print_open_photos() -> None:
    for slug, title, license_name in list_open_photos():
        print(f"{slug} | {title} | {license_name}")


def unregister_open_photos(slugs: list[str]) -> list[str]:
    document = load_photos_document()
    photos = document.get("photos", {})
    if not isinstance(photos, dict):
        return []
    removed: list[str] = []
    for slug in slugs:
        entry = photos.get(slug)
        if is_open_photo(entry):
            del photos[slug]
            removed.append(slug)
        elif isinstance(entry, Mapping):
            more = entry.get("more", [])
            kept_more = [photo for photo in more if not is_open_photo(photo)] if isinstance(more, list) else []
            if isinstance(more, list) and len(kept_more) < len(more):
                if kept_more:
                    entry["more"] = kept_more
                else:
                    entry.pop("more", None)
                removed.append(slug)
            else:
                print(f"Kept {slug}: its registered photo is not an open-source photo")
        elif entry is None:
            print(f"No open photo entry found for {slug}")
    if removed:
        document["photos"] = photos
        write_photos_document(document)
    return removed


def prune_unregistered_site_files() -> int:
    referenced = {
        str(photo.get("file"))
        for entry in load_photos_json().values()
        for photo in venue_photo_items(entry)
        if is_open_photo(photo) and photo.get("file")
    }
    if not PHOTO_DIR.exists():
        return 0
    removed = 0
    for path in PHOTO_DIR.iterdir():
        if path.is_file() and path.relative_to(REPO_ROOT / "public").as_posix() not in referenced:
            path.unlink()
            removed += 1
    return removed


def registered_photo(record: PhotoRecord) -> dict[str, str]:
    if not record.site_file or not record.site_file.startswith("photos/open/"):
        raise ValueError("registered open-photo files must be relative to public/ under photos/open/")
    registered = {
        "file": record.site_file,
        "creator": record.artist or record.source,
        "license": record.license,
        "sourceUrl": record.page_url,
        "source": record.source,
        "title": record.title,
    }
    if record.license_url:
        registered["licenseUrl"] = record.license_url
    return registered


def load_venues() -> list[dict[str, Any]]:
    if not VENUES_JSON.exists():
        sys.exit(f"{VENUES_JSON.relative_to(REPO_ROOT)} missing — run scripts/build_data.py first")
    with open(VENUES_JSON, encoding="utf-8") as handle:
        return json.load(handle).get("venues", [])


def find_venue(slug: str) -> dict[str, Any]:
    for venue in load_venues():
        if venue.get("slug") == slug:
            return venue
    sys.exit(f"Venue {slug} not found in {VENUES_JSON.relative_to(REPO_ROOT)}")


def candidate_name_match(record: PhotoRecord, venue_name: str) -> bool:
    return venue_name.casefold() in f"{record.title} {record.description or ''}".casefold()


def same_as_filename_description(title: str, description: str) -> bool:
    stem = Path(title).stem
    stem = re.sub(r"\s*\(\d{8,}\)$", "", stem)
    def normalize(value: str) -> str:
        return re.sub(r"[^\w]+", " ", value.replace("\u200b", "").casefold()).strip()

    return normalize(stem) == normalize(description)


def commons_name_search_eligible(
    record: PhotoRecord,
    venue_name: str,
    radius: int | None = None,
    venue_slug: str | None = None,
) -> bool:
    if not candidate_name_match(record, venue_name):
        return False
    if record.distance_m is not None and radius is not None and record.distance_m > radius:
        return False
    if record.lat is None and record.lon is None and record.description:
        if same_as_filename_description(record.title, record.description):
            return False
    return candidate_is_relevant(record, venue_name, venue_slug)


def candidate_score(record: PhotoRecord, venue_name: str, radius: int) -> float:
    score = 0.0
    if record.original_width and record.original_height:
        ratio = record.original_width / record.original_height
        if 0.6 <= ratio <= 1.9:
            score += 1.0
        score += min(record.original_width, 2000) / 2000.0
    words = [word for word in re.findall(r"[^\W_]+", venue_name.casefold()) if len(word) >= 3]
    haystack = f"{record.title} {record.description or ''}".casefold()
    if words and any(word in haystack for word in words):
        score += 1.5
    if record.distance_m is not None and radius > 0:
        score += 1.0 - record.distance_m / radius
    if record.source == "Wikimedia Commons":
        score += 0.2
    return score


def ranked_candidates(records: list[PhotoRecord], venue_name: str, radius: int) -> list[PhotoRecord]:
    unique: dict[str, PhotoRecord] = {}
    for record in records:
        unique.setdefault(record.original_url, record)
    return sorted(unique.values(), key=lambda record: candidate_score(record, venue_name, radius), reverse=True)


def select_unique_candidates(
    records: list[PhotoRecord], limit: int, reserved_original_urls: set[str] | None = None,
) -> list[PhotoRecord]:
    if limit <= 0:
        return []
    selected: list[PhotoRecord] = []
    used = set(reserved_original_urls or ())
    for record in records:
        if record.original_url in used:
            continue
        used.add(record.original_url)
        selected.append(record)
        if len(selected) >= limit:
            break
    return selected


def existing_photo_owners(
    photos: Mapping[str, Any], metadata: list[dict[str, Any]],
) -> dict[str, str | None]:
    owners: dict[str, str | None] = {}
    for slug, entry in photos.items():
        for photo in venue_photo_items(entry):
            if is_open_photo(photo) and photo.get("sourceUrl"):
                owners[str(photo["sourceUrl"])] = str(slug)
    for record in metadata:
        original_url = record.get("original_url")
        if original_url:
            venue_slug = record.get("venue_slug")
            owners.setdefault(str(original_url), str(venue_slug) if venue_slug else None)
    return owners


def registered_open_photo_is_rejected(
    photo: Mapping[str, Any], metadata: list[dict[str, Any]], radius: int,
) -> bool:
    if photo.get("source") not in {"Wikimedia Commons", "Flickr"}:
        return False
    title = str(photo.get("title", ""))
    if TITLE_REJECT.search(title):
        return True
    if photo.get("source") != "Wikimedia Commons":
        return False
    source_url = photo.get("sourceUrl")
    record = next((item for item in metadata if item.get("page_url") == source_url), None)
    if not record:
        return False
    distance = record.get("distance_m")
    if isinstance(distance, (int, float)) and distance > radius:
        return True
    if record.get("lat") is not None or record.get("lon") is not None:
        return False
    description = record.get("description")
    return bool(
        isinstance(description, str)
        and same_as_filename_description(str(record.get("title", title)), description)
    )


def print_candidates(records: list[PhotoRecord], venue_name: str, radius: int) -> None:
    if not records:
        print("  No open-licence photos found.")
        return
    for record in ranked_candidates(records, venue_name, radius):
        distance = f"{record.distance_m:.0f} m" if record.distance_m is not None else "unknown distance"
        print(f"  {record.title} | {record.license} | {record.artist or 'unknown artist'} | {distance} | {record.page_url}")


async def search_candidates(
    session: aiohttp.ClientSession,
    lat: float,
    lon: float,
    radius: int,
    limit: int,
    venue_name: str | None,
    sources: list[str],
    flickr_key: str | None,
    original: bool,
    name_search: bool,
    venue_slug: str | None = None,
) -> list[PhotoRecord]:
    tasks: list[asyncio.Task[list[PhotoRecord]]] = []
    if "commons" in sources:
        tasks.append(
            asyncio.create_task(
                search_commons(session, lat, lon, radius, limit, venue_name, original, name_search, venue_slug)
            )
        )
    if "flickr" in sources and flickr_key:
        tasks.append(
            asyncio.create_task(
                search_flickr(session, flickr_key, lat, lon, radius, limit, venue_name or "", venue_slug)
            )
        )
    if not tasks:
        return []
    results = await asyncio.gather(*tasks, return_exceptions=True)
    candidates: list[PhotoRecord] = []
    errors: list[Exception] = []
    for result in results:
        if isinstance(result, Exception):
            errors.append(result)
            print(f"Search error: {result}")
        else:
            candidates.extend(result)
    if not candidates and errors and len(errors) == len(tasks):
        raise RuntimeError("all photo-source searches failed") from errors[0]
    return ranked_candidates(candidates, venue_name or "", radius)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch open-licence trail and mountain photos from Wikimedia Commons and Flickr."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--venue", help="HillGPX venue slug to find photos for")
    group.add_argument("--lat", type=float, help="Latitude for an ad-hoc location")
    group.add_argument("--batch", action="store_true", help="Search multiple venues")
    group.add_argument("--list-open", action="store_true", help="List registered open-source photos")
    group.add_argument("--unregister-open", nargs="+", metavar="SLUG", help="Remove open photos for venue slugs")
    parser.add_argument("--lon", type=float, help="Longitude (required with --lat)")
    parser.add_argument("--radius", type=int, help="Search radius in metres")
    parser.add_argument("--limit", type=int, default=5, help="Maximum single-location candidates to download (default 5)")
    parser.add_argument("--per-venue", type=int, choices=(1, 2, 3), default=3, help="Batch photo target per venue (1–3, default 3)")
    parser.add_argument("--sources", default="commons,flickr", help="Comma-separated sources: commons,flickr")
    parser.add_argument("--type", choices=("hill", "hdb_block", "any"), default="hill", help="Batch venue type")
    parser.add_argument("--max-venues", type=int, default=50, help="Maximum venues in batch mode; 0 means no limit (default 50)")
    parser.add_argument("--research", action="store_true", help="Ignore recent underfilled batch-search entries")
    existing_group = parser.add_mutually_exclusive_group()
    existing_group.add_argument("--missing-only", dest="missing_only", action="store_true")
    existing_group.add_argument("--include-existing", dest="missing_only", action="store_false")
    parser.set_defaults(missing_only=True)
    parser.add_argument("--overwrite", action="store_true", help="Replace existing open photos for a venue")
    parser.add_argument("--no-name-search", action="store_true", help="Disable Commons title-search fallback")
    parser.add_argument("--original", action="store_true", help="Download full-res Commons originals, not 1280px thumbs")
    parser.add_argument("--dry-run", action="store_true", help="Search and rank candidates without writes")
    parser.add_argument("--build", action="store_true", help="Run scripts/build_data.py after saving")
    return parser.parse_args(argv)


def validate(args: argparse.Namespace) -> None:
    if args.lat is not None and args.lon is None:
        raise SystemExit("--lon is required with --lat")
    if args.limit < 1:
        raise SystemExit("--limit must be at least 1")
    if args.batch and args.max_venues < 0:
        raise SystemExit("--max-venues must be 0 (unlimited) or positive")
    if args.radius is not None and args.radius < 1:
        raise SystemExit("--radius must be at least 1 metre")
    sources = {source.strip().lower() for source in args.sources.split(",") if source.strip()}
    unknown = sources - {"commons", "flickr"}
    if unknown:
        raise SystemExit(f"Unknown photo source(s): {', '.join(sorted(unknown))}")
    if not sources:
        raise SystemExit("At least one photo source must be selected")


def venue_coords(venue: Mapping[str, Any]) -> tuple[float, float]:
    return float(venue["lat"]), float(venue.get("lon") or venue["lng"])


def venue_sort_key(venue: Mapping[str, Any]) -> tuple[int, float]:
    summit = venue.get("summitM")
    return (-int(bool(venue.get("notable"))), -float(summit) if summit is not None else math.inf)


def load_search_log() -> dict[str, dict[str, Any]]:
    if not SEARCH_LOG_PATH.exists():
        return {}
    try:
        with open(SEARCH_LOG_PATH, encoding="utf-8") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_search_log(search_log: Mapping[str, Any]) -> None:
    SEARCH_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = SEARCH_LOG_PATH.with_suffix(".tmp")
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(search_log, handle, separators=(",", ":"), ensure_ascii=False)
    os.replace(temporary, SEARCH_LOG_PATH)


def recent_unproductive_search(
    entry: Any,
    per_venue: int,
    now: datetime,
) -> bool:
    if not isinstance(entry, Mapping):
        return False
    searched_at = entry.get("searched_at")
    try:
        searched = datetime.fromisoformat(str(searched_at))
    except (TypeError, ValueError):
        return False
    if searched.tzinfo is None:
        searched = searched.replace(tzinfo=timezone.utc)
    age = now - searched.astimezone(timezone.utc)
    try:
        found = int(entry.get("found", 0))
    except (TypeError, ValueError):
        return False
    return timedelta(0) <= age < timedelta(days=30) and found < per_venue


def run_build() -> None:
    print("Running scripts/build_data.py")
    result = subprocess.run([sys.executable, "scripts/build_data.py"], cwd=REPO_ROOT)
    if result.returncode != 0:
        raise RuntimeError(f"build_data.py failed with exit code {result.returncode}")
    print("Application dataset rebuilt")


async def run_single(args: argparse.Namespace, session: aiohttp.ClientSession, flickr_key: str | None) -> int:
    if args.venue:
        venue = find_venue(args.venue)
        lat, lon = venue_coords(venue)
        venue_slug = args.venue
        venue_name = str(venue.get("name") or venue_slug)
    else:
        lat, lon = float(args.lat), float(args.lon)
        venue_slug = None
        venue_name = ""
    radius = args.radius if args.radius is not None else 1000
    print(f"Searching for photos near {lat:.5f}, {lon:.5f} (radius {radius} m)")

    photos = load_photos_json()
    if venue_slug and photos.get(venue_slug, {}).get("file") and not args.overwrite and not args.dry_run:
        print(f"Venue {venue_slug} already has a photo in data/photos.json; use --overwrite to replace it.")
        return 0
    metadata = await load_metadata()
    owners = existing_photo_owners(photos, metadata)
    candidates = await search_candidates(
        session,
        lat,
        lon,
        radius,
        args.limit,
        venue_name or None,
        [source.strip().lower() for source in args.sources.split(",") if source.strip()],
        flickr_key,
        args.original,
        not args.no_name_search,
        venue_slug,
    )
    if args.dry_run:
        print_candidates(candidates, venue_name, radius)
        return 0

    candidates = [
        record for record in candidates
        if all(
            url not in owners or (venue_slug is not None and owners[url] == venue_slug)
            for url in (record.original_url, record.page_url)
        )
    ]
    print_candidates(candidates, venue_name, radius)
    selected = candidates[: args.limit]
    downloaded_results = await asyncio.gather(
        *(download_photo(session, record, index, venue_slug) for index, record in enumerate(selected, 1))
    )
    downloaded = [record for record in downloaded_results if record]
    if not downloaded:
        existing = photos.get(venue_slug, {}) if venue_slug else {}
        if (
            venue_slug
            and args.overwrite
            and isinstance(existing, Mapping)
            and registered_open_photo_is_rejected(existing, metadata, radius)
        ):
            removed = unregister_open_photos([venue_slug])
            await sync_metadata_registration()
            prune_unregistered_site_files()
            print(f"Removed rejected open photo from venue {venue_slug}: {bool(removed)}")
            if args.build:
                run_build()
            return 0
        print("No photos could be downloaded.")
        return 0
    await save_metadata(downloaded)
    print(f"Saved metadata to {METADATA_PATH.relative_to(REPO_ROOT)}")
    if venue_slug:
        best = downloaded[0]
        save_photos_json({venue_slug: registered_photo(best)})
        print(f"Registered {best.site_file} for venue {venue_slug}")
    await sync_metadata_registration()
    if args.build:
        run_build()
    print(f"Downloaded {len(downloaded)} photo(s).")
    return 0


async def run_batch(args: argparse.Namespace, session: aiohttp.ClientSession, flickr_key: str | None) -> int:
    photos = load_photos_json()
    metadata = await load_metadata()
    owners = existing_photo_owners(photos, metadata)
    search_log = load_search_log()
    selected_type = args.type
    venues = [
        venue for venue in load_venues()
        if selected_type == "any" or venue.get("type") == selected_type
    ]
    venues.sort(key=venue_sort_key)
    if args.max_venues > 0:
        venues = venues[: args.max_venues]

    skipped_existing = 0
    skipped_recent = 0
    to_search: list[dict[str, Any]] = []
    needed_by_slug: dict[str, int] = {}
    now = datetime.now(timezone.utc)
    for venue in venues:
        slug = str(venue["slug"])
        entry = photos.get(slug, {})
        needed = args.per_venue if args.overwrite else photos_needed(entry, args.per_venue)
        if needed <= 0:
            skipped_existing += 1
            continue
        if not args.research and recent_unproductive_search(
            search_log.get(slug), args.per_venue, now
        ):
            skipped_recent += 1
            continue
        needed_by_slug[slug] = needed
        to_search.append(venue)

    radius = args.radius if args.radius is not None else (1500 if selected_type == "hill" else 1000)
    sources = [source.strip().lower() for source in args.sources.split(",") if source.strip()]
    semaphore = asyncio.Semaphore(VENUE_CONCURRENCY)
    assignment_lock = asyncio.Lock()
    reserved_urls = dict(owners)
    completed_outcomes: dict[str, tuple[list[PhotoRecord], bool, int | None]] = {}
    searched = 0
    photos_added = 0
    errors = 0
    elapsed_start = time.monotonic()

    async def process(
        venue: dict[str, Any], index: int,
    ) -> tuple[str, list[PhotoRecord], bool, int | None]:
        slug = str(venue["slug"])
        name = str(venue.get("name") or slug)
        lat, lon = venue_coords(venue)
        entry = photos.get(slug, {})
        needed = needed_by_slug[slug]
        current_urls = registered_photo_urls(slug, entry, metadata)
        async with semaphore:
            try:
                candidates = await search_candidates(
                    session,
                    lat,
                    lon,
                    radius,
                    args.per_venue,
                    name,
                    sources,
                    flickr_key,
                    args.original,
                    not args.no_name_search,
                    slug,
                )
                available = [
                    record for record in candidates
                    if record.original_url not in current_urls and record.page_url not in current_urls
                    and all(
                        url not in owners or owners[url] == slug
                        for url in (record.original_url, record.page_url)
                    )
                ]
                available = select_unique_candidates(available, len(available))
                found = len(available)
                if args.dry_run:
                    print(f"{slug} — {name}")
                    print_candidates(available, name, radius)
                    result = (slug, [], False, found)
                    completed_outcomes[slug] = (result[1], result[2], result[3])
                    return result

                print(f"{slug} — {name}: {found} available candidate(s), filling {needed}")
                chosen = select_unique_candidates(available, needed)
                downloaded: list[PhotoRecord] = []
                attempted = 0
                for candidate_index, candidate in enumerate(chosen, 1):
                    async with assignment_lock:
                        candidate_urls = (candidate.original_url, candidate.page_url)
                        if any(
                            url in reserved_urls and reserved_urls[url] != slug
                            for url in candidate_urls
                        ):
                            continue
                        newly_reserved = [url for url in candidate_urls if url not in reserved_urls]
                        for url in candidate_urls:
                            reserved_urls[url] = slug
                    attempted += 1
                    record = await download_photo(
                        session, candidate, index * 10 + candidate_index, slug
                    )
                    if record:
                        downloaded.append(record)
                    else:
                        async with assignment_lock:
                            for url in newly_reserved:
                                if reserved_urls.get(url) == slug:
                                    reserved_urls.pop(url)
                failed = attempted > len(downloaded)
                result = (slug, downloaded, failed, found)
                completed_outcomes[slug] = (downloaded, failed, found)
                return result
            except Exception as exc:
                print(f"  venue {slug} failed: {exc}")
                result = (slug, [], True, None)
                completed_outcomes[slug] = (result[1], result[2], result[3])
                return result

    async def persist_outcomes(
        outcomes: list[tuple[str, list[PhotoRecord], bool, int | None]],
    ) -> None:
        nonlocal photos_added, errors
        downloaded_records: list[PhotoRecord] = []
        photo_updates: dict[str, dict[str, Any]] = {}
        search_timestamp = datetime.now(timezone.utc).isoformat()
        for slug, downloaded, failed, found in outcomes:
            if found is not None:
                search_log[slug] = {"searched_at": search_timestamp, "found": found}
            if failed:
                errors += 1
            if downloaded:
                current = photos.get(slug, {})
                updated = merge_open_photo_entry(
                    current,
                    [registered_photo(record) for record in downloaded],
                    args.per_venue,
                    args.overwrite,
                )
                photos[slug] = updated
                photo_updates[slug] = updated
                downloaded_records.extend(downloaded)
                photos_added += len(downloaded)
        if downloaded_records:
            await save_metadata(downloaded_records)
        if photo_updates:
            save_photos_json(photo_updates)
        await sync_metadata_registration()
        save_search_log(search_log)

    def log_progress(processed: int, total: int) -> None:
        venues_with_photos = sum(
            1 for venue in venues if open_photo_count(photos.get(str(venue["slug"]), {})) > 0
        )
        print(
            f"Progress: {processed}/{total} venues; {venues_with_photos} with photos; "
            f"{photos_added} photos added; {errors} errors; "
            f"{time.monotonic() - elapsed_start:.1f}s elapsed",
            flush=True,
        )

    total = len(venues)
    searched_venues = 0
    completed_processed = skipped_existing + skipped_recent
    chunk_size = 25
    try:
        for offset in range(0, len(to_search), chunk_size):
            chunk = to_search[offset : offset + chunk_size]
            completed_outcomes.clear()
            results = await asyncio.gather(
                *(process(venue, offset + index + 1) for index, venue in enumerate(chunk))
            )
            await persist_outcomes(results)
            completed_outcomes.clear()
            searched_venues += len(chunk)
            searched += len(chunk)
            completed_processed = skipped_existing + skipped_recent + searched_venues
            log_progress(completed_processed, total)
    except (KeyboardInterrupt, asyncio.CancelledError):
        completed = [
            (slug, downloaded, failed, found)
            for slug, (downloaded, failed, found) in completed_outcomes.items()
        ]
        if completed and not args.dry_run:
            await persist_outcomes(completed)
        raise

    if not args.dry_run:
        await sync_metadata_registration()
        pruned = prune_unregistered_site_files()
        if pruned:
            print(f"Removed {pruned} unregistered WebP file(s).")
    venues_with_photos = sum(
        1 for venue in venues if open_photo_count(photos.get(str(venue["slug"]), {})) > 0
    )
    skipped = skipped_existing + skipped_recent
    print(
        f"Batch summary: venues searched {searched} / with photos {venues_with_photos} "
        f"/ skipped {skipped} / photos added {photos_added} / errors {errors}"
    )
    if args.build and not args.dry_run:
        run_build()
    return 0


async def main_async(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.list_open:
        print_open_photos()
        return 0
    if args.unregister_open:
        removed = unregister_open_photos(args.unregister_open)
        await sync_metadata_registration()
        print(f"Unregistered {len(removed)} open photo(s).")
        return 0
    validate(args)
    flickr_key = read_env_token("FLICKR_API_KEY")
    sources = {source.strip().lower() for source in args.sources.split(",") if source.strip()}
    if "flickr" in sources and not flickr_key:
        print("Flickr skipped: set FLICKR_API_KEY in .env.local or the environment")
    async with aiohttp.ClientSession(
        headers={"User-Agent": USER_AGENT},
        connector=aiohttp.TCPConnector(ssl=ssl_context()),
    ) as session:
        if args.batch:
            return await run_batch(args, session, flickr_key)
        return await run_single(args, session, flickr_key)


def main() -> int:
    try:
        return asyncio.run(main_async())
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"Photo fetch failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
