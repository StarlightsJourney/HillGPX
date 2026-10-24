#!/usr/bin/env python3
"""Publish CSV name,url rows anonymously through HillGPX's normal upload form.

Requires a virtual environment with: python3 -m pip install playwright
and: python3 -m playwright install chromium
Defaults to production. --dry-run downloads/profiles without publishing.
Only provide tracks you can share under the form's CC BY 4.0 licence.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import socket
import sys
import tempfile
import time
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path

# Reuse the repository TLS certificate fallback after moving out of scripts/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from fetch_peaks import ssl_context  # noqa: E402

SITE = "https://hillgpx.com"
MAX_BYTES = 60_000_000
DEFAULT_DELAY = 1  # Anonymous uploads: 10/hour, with a little margin.


class UploadQuotaError(RuntimeError):
    """A server quota applies to the whole batch, not just this route."""


def quota_message(message: str) -> bool:
    return any(text in message.lower() for text in (
        "you have added a lot in a short time",
        "too many contributions today",
        "uploads are paused for a little while because of heavy traffic",
    ))


def read_rows(path: Path) -> list[tuple[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames or not {"name", "url"} <= set(reader.fieldnames):
            raise ValueError("CSV needs headers: name,url")
        rows = []
        for number, row in enumerate(reader, 2):
            name, url = (row.get("name") or "").strip(), (row.get("url") or "").strip()
            if not name and not url:
                continue
            parsed = urllib.parse.urlsplit(url)
            if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError(f"CSV row {number}: url must be a direct HTTP(S) GPX link without credentials")
            rows.append((name, url))
    if not rows:
        raise ValueError("CSV contains no routes")
    return rows


def row_key(site: str, name: str, url: str) -> str:
    return hashlib.sha256(json.dumps([site, name, url]).encode()).hexdigest()


def completed(path: Path) -> set[str]:
    if not path.exists():
        return set()
    result = set()
    with path.open(encoding="utf-8") as stream:
        for number, line in enumerate(stream, 1):
            try:
                entry = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid progress log at line {number}: {path}") from exc
            if not isinstance(entry, dict) or not isinstance(entry.get("key"), str):
                raise ValueError(f"Invalid progress entry at line {number}: {path}")
            if entry.get("status") in ("published", "duplicate"):
                result.add(entry["key"])
    return result


def record(path: Path, **entry: object) -> None:
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(entry, ensure_ascii=False) + "\n")
        stream.flush()


def download(url: str, timeout: float) -> bytes:
    if " https://hiking.waymarkedtra" in url:
        raise ValueError("Waymarked Trails GPX downloads require a browser session; use the direct GPX link instead")
    request = urllib.request.Request(url, headers={"User-Agent": "HillGPX CSV uploader", "Accept": "application/gpx+xml,application/xml,text/xml"})

    with urllib.request.urlopen(request, timeout=timeout, context=ssl_context()) as response:
        if urllib.parse.urlsplit(response.url).scheme not in ("http", "https"):
            raise ValueError("Download redirected outside HTTP(S)")
        data = response.read(MAX_BYTES + 1)
    if not data or len(data) > MAX_BYTES:
        raise ValueError("GPX must be nonempty and at most 60 MB")
    return data


def upload_one(page, site: str, name: str, data: bytes, dry_run: bool) -> tuple[str, str]:
    # A reload clears the previous import, including errors and duplicate notices.
    page.goto(site + "/#import", wait_until="domcontentloaded")
    picker = page.locator('.gpx-import input[type="file"]')
    picker.wait_for(state="attached")
    picker.set_input_files({"name": "route.gpx", "mimeType": "application/gpx+xml", "buffer": data})
    page.wait_for_function("""() => document.querySelector('.gpx-panel .gpx-publish') ||
        document.querySelector('.gpx-import [role="alert"]')""")
    duplicate = page.locator(".gpx-import-duplicate")
    if duplicate.count():
        return "duplicate", duplicate.inner_text()
    error = page.locator('.gpx-import [role="alert"]')
    if error.count():
        raise ValueError(error.inner_text())
    page.get_by_label("Route name", exact=True).fill(name)
    if dry_run:
        return "validated", "Downloaded and profiled; no publish request sent"
    page.get_by_role("button", name="Publish route", exact=True).click()
    page.wait_for_function("""() => document.querySelector('.gpx-published') ||
        document.querySelector('.gpx-publish [role="alert"]')""")
    if page.locator(".gpx-published").count():
        # Allow the normal background thumbnail upload to finish when possible.
        page.wait_for_timeout(3)
        return "published", "Published anonymously under CC BY 4.0"
    message = page.locator('.gpx-publish [role="alert"]').inner_text()
    if "already in the community archive" in message:
        return "duplicate", message
    if quota_message(message):
        raise UploadQuotaError(message)
    raise RuntimeError(message)



def upload_with_retries(page, site: str, name: str, url: str, dry_run: bool, *,
                        timeout: float, retries: int, retry_delay: float,
                        progress: Path, key: str) -> tuple[str, str]:
    """Retry a row, retaining downloaded bytes and rechecking duplicates each time."""
    data: bytes | None = None
    wait = min(retry_delay, 300)
    for attempt in range(1, retries + 2):
        print(f"  Attempt {attempt}/{retries + 1}", flush=True)
        try:
            if data is None:
                try:
                    data = download(url, timeout)
                except urllib.error.HTTPError as exc:
                    if exc.code == 404:
                        return "failed", f"Skipping missing GPX link (HTTP 404): {url}"
                    raise
            return upload_one(page, site, name, data, dry_run)
        except UploadQuotaError as exc:
            return "quota_limited", str(exc)
        except Exception as exc:
            if attempt == retries + 1:
                return "failed", f"Failed after {attempt} attempts: {exc}"
            record(progress, key=key, name=name, status="retrying", attempt=attempt, message=str(exc))
            print(f"  Failed: {exc}\n  Retrying in {wait:g}s…", flush=True)
            time.sleep(wait)
            wait = min(wait * 2, 300)
    raise AssertionError("Retry loop must return")



def tor_proxy(server: str, timeout: float) -> dict[str, str]:
    """Require a responding SOCKS5 listener before starting the upload browser."""
    parsed = urllib.parse.urlsplit(server)
    if (parsed.scheme != "socks5" or not parsed.hostname or not parsed.port
            or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
        raise ValueError("--tor expects socks5://HOST:PORT, e.g. socks5://127.0.0.1:9050")
    try:
        with socket.create_connection((parsed.hostname, parsed.port), timeout=min(timeout, 10)) as connection:
            connection.sendall(b"\x05\x01\x00")
            reply = b""
            while len(reply) < 2:
                chunk = connection.recv(2 - len(reply))
                if not chunk:
                    break
                reply += chunk
            if reply != b"\x05\x00":
                raise ValueError("Tor proxy did not accept an unauthenticated SOCKS5 connection")
    except OSError as exc:
        raise ValueError(f"Cannot connect to Tor at {server}. Start Tor first; no direct fallback will be used. ({exc})") from exc
    return {"server": server}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True, help="UTF-8 CSV with name,url columns")
    parser.add_argument("--site", default=SITE, help="Site origin (default: production https://hillgpx.com)")
    parser.add_argument("--dry-run", action="store_true", help="Download and profile, block browser writes, never publish")
    parser.add_argument("--headed", action="store_true", help="Show the browser")
    parser.add_argument("--progress", type=Path, help="Append-only JSONL resume log (default: OS temp/hillgpx-<CSV and site hash>.jsonl)")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY, help="Seconds between rows (default: 370 for the anonymous 10/hour quota; 30/day still applies)")
    parser.add_argument("--timeout", type=float, default=600, help="Download/browser timeout in seconds (default: 600; includes GPX form loading and profiling)")
    parser.add_argument("--retries", type=int, default=10, help="Retries per failed row after the initial attempt (default: 10)")
    parser.add_argument("--retry-delay", type=float, default=30, help="Initial retry wait in seconds, doubled up to 300s (default: 30)")
    parser.add_argument("--tor", nargs="?", const="socks5://127.0.0.1:9050", metavar="SOCKS_URL", help="Route the upload browser through Tor (default SOCKS endpoint: socks5://127.0.0.1:9050)")
    args = parser.parse_args(argv)
    site = args.site.rstrip("/")
    parsed = urllib.parse.urlsplit(site)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        parser.error("--site must be an HTTP(S) origin, e.g. https://hillgpx.com")
    if args.delay < 0 or args.retry_delay < 0 or args.timeout <= 0 or args.retries < 0:
        parser.error("--delay, --retry-delay and --retries must be nonnegative; --timeout must be positive")
    try:
        rows = read_rows(args.csv)
        batch = hashlib.sha256((str(args.csv.resolve()) + site).encode()).hexdigest()[:16]
        progress = args.progress or Path(tempfile.gettempdir()) / f"hillgpx-{batch}.jsonl"
        done = completed(progress) if not args.dry_run else set()
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    remaining = sum(row_key(site, name, url) not in done for name, url in rows)
    if not remaining:
        print(f"All {len(rows)} CSV rows are already completed. Progress: {progress}", flush=True)
        return 0
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        parser.error("Install Playwright in your virtual environment: python3 -m pip install playwright; python3 -m playwright install chromium")
    try:
        proxy = tor_proxy(args.tor, args.timeout) if args.tor is not None else None
    except ValueError as exc:
        parser.error(str(exc))
    if proxy:
        print(f"Upload browser via Tor: {proxy['server']} (GPX source downloads remain direct)", flush=True)
    print(f"{'DRY RUN' if args.dry_run else 'PUBLISH'}: {remaining} remaining of {len(rows)} routes → {site}", flush=True)
    print(f"Progress: {progress}", flush=True)
    failures = 0
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not args.headed, proxy=proxy)
        # No persistent profile, cookies, login state or user credentials.
        context = browser.new_context(service_workers="block")
        context.set_default_timeout(args.timeout * 1000)
        context.set_default_navigation_timeout(args.timeout * 1000)

        def guard(route):
            request = route.request
            if args.dry_run and request.method not in ("GET", "HEAD", "OPTIONS"):
                route.abort()
                return
            if request.method == "POST" and urllib.parse.urlsplit(request.url).path == "/rest/v1/routes":
                payload = request.post_data_json
                if not isinstance(payload, dict) or payload.get("anonymous") is False or payload.get("contributor") is not None or request.headers.get("authorization"):
                    route.abort()
                    return
            route.continue_()

        context.route("**/*", guard)
        page = context.new_page()
        try:
            for index, (name, url) in enumerate(rows, 1):
                key = row_key(site, name, url)
                if key in done:
                    print(f"[{index}/{len(rows)}] SKIP {name} (already completed)", flush=True)
                    continue
                print(f"[{index}/{len(rows)}] {name}", flush=True)
                status, message = upload_with_retries(
                    page, site, name, url, args.dry_run, timeout=args.timeout,
                    retries=args.retries, retry_delay=args.retry_delay,
                    progress=progress, key=key,
                )
                if status in ("failed", "quota_limited"):
                    failures += 1
                record(progress, key=key, name=name, status=status, message=message)
                if status in ("published", "duplicate") and not args.dry_run:
                    done.add(key)
                print(f"  {status}: {message}", flush=True)
                if status == "quota_limited":
                    print("Batch stopped: the server quota also affects the remaining routes. "
                          "Anonymous limits are 10/hour and 30/day per connection; "
                          "the server does not say which window was exceeded. "
                          "Wait for the quota to reset (up to 24 hours), then resume "
                          f"with the same --progress {progress}. Completed rows will be skipped.", flush=True)
                    break
                if any(row_key(site, n, u) not in done for n, u in rows[index:]):
                    time.sleep(args.delay)
        finally:
            context.close()
            browser.close()
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
