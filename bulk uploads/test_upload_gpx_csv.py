"""Offline checks for the anonymous CSV uploader (no production writes)."""
from __future__ import annotations

import tempfile
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import upload_gpx_csv as uploader


class CsvAndProgressTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="hillgpx-")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "routes.csv"

    def test_csv_preserves_quoted_names_and_skips_empty_rows(self) -> None:
        self.path.write_text('\ufeffname,url\n" Hill, trail ", https://example.org/a.gpx \n,\n', encoding="utf-8")
        self.assertEqual(uploader.read_rows(self.path), [("Hill, trail", "https://example.org/a.gpx")])

    def test_csv_rejects_invalid_inputs(self) -> None:
        cases = [
            "name,link\nHill,https://example.org/a.gpx\n",
            "name,url\n,\n",
            "name,url\n,https://example.org/a.gpx\n",
            "name,url\n" + "x" * 121 + ",https://example.org/a.gpx\n",
            "name,url\nHill,file:///tmp/a.gpx\n",
            "name,url\nHill,https://user:password@example.org/a.gpx\n",
            "name,url\nHill,https:///a.gpx\n",
        ]
        for content in cases:
            with self.subTest(content=content):
                self.path.write_text(content, encoding="utf-8")
                with self.assertRaises(ValueError):
                    uploader.read_rows(self.path)

    def test_resume_only_skips_published_or_duplicate_rows(self) -> None:
        self.assertEqual(uploader.completed(self.path), set())
        for status in ("validated", "download_failed", "failed", "published", "duplicate"):
            uploader.record(self.path, key=status, status=status, name="山")
        self.assertEqual(uploader.completed(self.path), {"published", "duplicate"})
        self.assertIn("山", self.path.read_text(encoding="utf-8"))

    def test_resume_rejects_a_truncated_log(self) -> None:
        self.path.write_text('{"key":"ok","status":"published"}\n{"key":', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "line 2"):
            uploader.completed(self.path)

    def test_row_key_includes_site_name_and_url(self) -> None:
        key = uploader.row_key("https://hillgpx.com", "Hill", "https://example.org/a.gpx")
        self.assertEqual(key, uploader.row_key("https://hillgpx.com", "Hill", "https://example.org/a.gpx"))
        for args in (("http://localhost", "Hill", "https://example.org/a.gpx"),
                     ("https://hillgpx.com", "Other", "https://example.org/a.gpx"),
                     ("https://hillgpx.com", "Hill", "https://example.org/b.gpx")):
            self.assertNotEqual(key, uploader.row_key(*args))

    def test_resume_rejects_invalid_entry_shapes(self) -> None:
        for content in ('null\n', '[]\n', '{"status":"published"}\n'):
            with self.subTest(content=content):
                self.path.write_text(content, encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "line 1"):
                    uploader.completed(self.path)


class DownloadTests(unittest.TestCase):
    def download(self, data: bytes, url: str = "https://example.org/a.gpx") -> bytes:
        response = MagicMock()
        response.url = url
        response.read.return_value = data
        with patch.object(uploader, "MAX_BYTES", 8), patch.object(uploader, "ssl_context"), patch.object(uploader.urllib.request, "urlopen") as open_url:
            open_url.return_value.__enter__.return_value = response
            result = uploader.download("https://example.org/start.gpx", 12)
            response.read.assert_called_once_with(9)
            self.assertEqual(open_url.call_args.kwargs["timeout"], 12)
            return result

    def test_download_accepts_file_at_size_limit(self) -> None:
        self.assertEqual(self.download(b"12345678"), b"12345678")

    def test_download_rejects_empty_or_oversize_files(self) -> None:
        for data in (b"", b"123456789"):
            with self.subTest(data=data), self.assertRaisesRegex(ValueError, "60 MB"):
                self.download(data)

    def test_download_rejects_non_http_redirect(self) -> None:
        with self.assertRaisesRegex(ValueError, "redirected outside"):
            self.download(b"123", "file:///tmp/track.gpx")


class BrowserFlowTests(unittest.TestCase):
    def page(self) -> MagicMock:
        page = MagicMock()
        locators: dict[str, MagicMock] = {}

        def locator(selector: str) -> MagicMock:
            if selector not in locators:
                locators[selector] = MagicMock()
                locators[selector].count.return_value = 0
            return locators[selector]

        page.locator.side_effect = locator
        return page

    def test_dry_run_profiles_and_sets_name_without_publish_click(self) -> None:
        page = self.page()
        status, _ = uploader.upload_one(page, uploader.SITE, "Hill", b"gpx", True)
        self.assertEqual(status, "validated")
        page.goto.assert_called_once_with(uploader.SITE + "/#import", wait_until="domcontentloaded")
        page.locator('.gpx-import input[type="file"]').set_input_files.assert_called_once_with(
            {"name": "route.gpx", "mimeType": "application/gpx+xml", "buffer": b"gpx"})
        page.get_by_label.assert_called_once_with("Route name", exact=True)
        page.get_by_label.return_value.fill.assert_called_once_with("Hill")
        page.get_by_role.assert_not_called()

    def test_import_duplicate_does_not_publish(self) -> None:
        page = self.page()
        page.locator(".gpx-import-duplicate").count.return_value = 1
        page.locator(".gpx-import-duplicate").inner_text.return_value = "Already imported"
        self.assertEqual(uploader.upload_one(page, uploader.SITE, "Hill", b"gpx", False),
                         ("duplicate", "Already imported"))
        page.get_by_role.assert_not_called()

    def test_import_error_stops_before_publishing(self) -> None:
        page = self.page()
        page.locator('.gpx-import [role="alert"]').count.return_value = 1
        page.locator('.gpx-import [role="alert"]').inner_text.return_value = "Invalid GPX"
        with self.assertRaisesRegex(ValueError, "Invalid GPX"):
            uploader.upload_one(page, uploader.SITE, "Hill", b"gpx", False)
        page.get_by_role.assert_not_called()

    def test_successful_publish_waits_for_thumbnail(self) -> None:
        page = self.page()
        page.locator(".gpx-published").count.return_value = 1
        status, _ = uploader.upload_one(page, uploader.SITE, "Hill", b"gpx", False)
        self.assertEqual(status, "published")
        page.get_by_role.assert_called_once_with("button", name="Publish route", exact=True)
        page.get_by_role.return_value.click.assert_called_once()
        page.wait_for_timeout.assert_called_once_with(3000)

    def test_publish_duplicate_is_resumable(self) -> None:
        page = self.page()
        message = "This track is already in the community archive"
        page.locator('.gpx-publish [role="alert"]').inner_text.return_value = message
        self.assertEqual(uploader.upload_one(page, uploader.SITE, "Hill", b"gpx", False),
                         ("duplicate", message))

    def test_publish_error_is_reported(self) -> None:
        page = self.page()
        page.locator('.gpx-publish [role="alert"]').inner_text.return_value = "Hourly limit reached"
        with self.assertRaisesRegex(RuntimeError, "Hourly limit reached"):
            uploader.upload_one(page, uploader.SITE, "Hill", b"gpx", False)

    def test_quota_errors_are_distinct_from_transient_failures(self) -> None:
        for message in (
            "You have added a lot in a short time. Please wait a while and try again.",
            "hillGPX is taking a breather: too many contributions today. Please try again tomorrow.",
            "Uploads are paused for a little while because of heavy traffic. Please try again later.",
        ):
            with self.subTest(message=message):
                page = self.page()
                page.locator('.gpx-publish [role="alert"]').inner_text.return_value = message
                with self.assertRaises(uploader.UploadQuotaError):
                    uploader.upload_one(page, uploader.SITE, "Hill", b"gpx", False)


class TorProxyTests(unittest.TestCase):
    def test_fragmented_socks_greeting_is_accepted(self) -> None:
        with patch.object(uploader.socket, "create_connection") as connect:
            connection = connect.return_value.__enter__.return_value
            connection.recv.side_effect = [b"\x05", b"\x00"]
            server = "socks5://127.0.0.1:9050"
            self.assertEqual(uploader.tor_proxy(server, 180), {"server": server})
            connect.assert_called_once_with(("127.0.0.1", 9050), timeout=10)
            connection.sendall.assert_called_once_with(b"\x05\x01\x00")
            self.assertEqual([call.args[0] for call in connection.recv.call_args_list], [2, 1])

    def test_shorter_timeout_is_preserved(self) -> None:
        with patch.object(uploader.socket, "create_connection") as connect:
            connect.return_value.__enter__.return_value.recv.return_value = b"\x05\x00"
            uploader.tor_proxy("socks5://localhost:9150", 3)
            connect.assert_called_once_with(("localhost", 9150), timeout=3)

    def test_unavailable_proxy_does_not_fall_back(self) -> None:
        with patch.object(uploader.socket, "create_connection", side_effect=ConnectionRefusedError("refused")):
            with self.assertRaisesRegex(ValueError, "no direct fallback"):
                uploader.tor_proxy("socks5://127.0.0.1:9050", 180)

    def test_rejected_or_truncated_socks_greetings_fail(self) -> None:
        for reply in ([b"\x05\xff"], [b"\x04\x00"], [b""], [b"\x05", b""]):
            with self.subTest(reply=reply), patch.object(uploader.socket, "create_connection") as connect:
                connect.return_value.__enter__.return_value.recv.side_effect = reply
                with self.assertRaisesRegex(ValueError, "SOCKS5"):
                    uploader.tor_proxy("socks5://127.0.0.1:9050", 180)

    def test_malformed_proxy_is_rejected_before_connecting(self) -> None:
        for server in ("http://localhost:9050", "socks5://localhost", "socks5://:9050",
                       "socks5://localhost:0", "socks5://localhost:-1", "socks5://localhost:65536",
                       "socks5://localhost:bad", "socks5://user:pass@localhost:9050",
                       "socks5://localhost:9050/", "socks5://localhost:9050?x=1",
                       "socks5://localhost:9050#fragment", "socks5://[broken"):
            with self.subTest(server=server), patch.object(uploader.socket, "create_connection") as connect:
                with self.assertRaises(ValueError):
                    uploader.tor_proxy(server, 180)
                connect.assert_not_called()


class TorBrowserTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="hillgpx-tor-tests-")
        self.addCleanup(self.temp.cleanup)
        self.csv = Path(self.temp.name) / "routes.csv"
        self.csv.write_text("name,url\nHill,https://example.org/a.gpx\n")
        self.arguments = ["--csv", str(self.csv), "--progress", str(Path(self.temp.name) / "progress.jsonl")]
        self.sync_api = types.ModuleType("playwright.sync_api")
        self.sync_api.sync_playwright = MagicMock()
        self.playwright = self.sync_api.sync_playwright.return_value.__enter__.return_value

    def test_tor_option_passes_verified_proxy_to_chromium(self) -> None:
        for option in (["--tor"], ["--tor", "socks5://localhost:9150"]):
            server = option[1] if len(option) > 1 else "socks5://127.0.0.1:9050"
            with self.subTest(option=option), patch.dict(sys.modules, {"playwright.sync_api": self.sync_api}), \
                    patch.object(uploader, "tor_proxy", return_value={"server": server}) as proxy, \
                    patch.object(uploader, "upload_with_retries", return_value=("validated", "Done")) as upload:
                self.assertEqual(uploader.main(self.arguments + ["--dry-run"] + option), 0)
                proxy.assert_called_once_with(server, 600)
                self.playwright.chromium.launch.assert_called_with(headless=True, proxy={"server": server})
                upload.assert_called_once()

    def test_unavailable_tor_aborts_before_browser_or_upload(self) -> None:
        with patch.dict(sys.modules, {"playwright.sync_api": self.sync_api}), \
                patch.object(uploader.socket, "create_connection", side_effect=ConnectionRefusedError("refused")), \
                patch.object(uploader, "upload_with_retries") as upload:
            with self.assertRaises(SystemExit) as error:
                uploader.main(self.arguments + ["--tor"])
            self.assertEqual(error.exception.code, 2)
            self.sync_api.sync_playwright.assert_not_called()
            self.playwright.chromium.launch.assert_not_called()
            upload.assert_not_called()

    def test_default_browser_remains_direct(self) -> None:
        with patch.dict(sys.modules, {"playwright.sync_api": self.sync_api}), \
                patch.object(uploader, "tor_proxy") as proxy, \
                patch.object(uploader, "upload_with_retries", return_value=("validated", "Done")):
            self.assertEqual(uploader.main(self.arguments + ["--dry-run"]), 0)
            proxy.assert_not_called()
            self.playwright.chromium.launch.assert_called_once_with(headless=True, proxy=None)

    def test_browser_timeout_defaults_to_ten_minutes_and_can_be_overridden(self) -> None:
        for options, milliseconds in (([], 600_000), (["--timeout", "900"], 900_000)):
            with self.subTest(options=options), \
                    patch.dict(sys.modules, {"playwright.sync_api": self.sync_api}), \
                    patch.object(uploader, "upload_with_retries", return_value=("validated", "Done")) as upload:
                self.assertEqual(uploader.main(self.arguments + ["--dry-run"] + options), 0)
                context = self.playwright.chromium.launch.return_value.new_context.return_value
                context.set_default_timeout.assert_called_with(milliseconds)
                context.set_default_navigation_timeout.assert_called_with(milliseconds)
                self.assertEqual(upload.call_args.kwargs["timeout"], milliseconds / 1000)


class RetryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="hillgpx-retries-")
        self.addCleanup(self.temp.cleanup)
        self.progress = Path(self.temp.name) / "progress.jsonl"

    def run_row(self, retries: int = 10, retry_delay: float = 30) -> tuple[str, str]:
        return uploader.upload_with_retries(
            MagicMock(), uploader.SITE, "Hill", "https://example.org/a.gpx", False,
            timeout=180, retries=retries, retry_delay=retry_delay,
            progress=self.progress, key="row",
        )

    def test_missing_link_is_skipped_but_server_errors_are_retried(self) -> None:
        url = "https://example.org/a.gpx"
        for code in (404, 503):
            with self.subTest(code=code), \
                    patch.object(uploader, "download", side_effect=[
                        uploader.urllib.error.HTTPError(url, code, "HTTP error", None, None), b"gpx",
                    ]) as download, \
                    patch.object(uploader, "upload_one", return_value=("published", "Done")) as upload, \
                    patch.object(uploader.time, "sleep") as sleep:
                status, message = self.run_row()
                if code == 404:
                    self.assertEqual(status, "failed")
                    self.assertIn("Skipping missing GPX link (HTTP 404)", message)
                    self.assertIn(url, message)
                    download.assert_called_once()
                    upload.assert_not_called()
                    sleep.assert_not_called()
                else:
                    self.assertEqual(status, "published")
                    self.assertEqual(download.call_count, 2)
                    upload.assert_called_once()
                    sleep.assert_called_once_with(30)

    @patch.object(uploader.time, "sleep")
    @patch.object(uploader, "upload_one", side_effect=uploader.UploadQuotaError("You have added a lot in a short time"))
    @patch.object(uploader, "download", return_value=b"gpx")
    def test_quota_is_not_retried(self, download, upload, sleep) -> None:
        self.assertEqual(self.run_row()[0], "quota_limited")
        upload.assert_called_once()
        sleep.assert_not_called()

    def test_completed_batch_does_not_start_playwright(self) -> None:
        csv = Path(self.temp.name) / "routes.csv"
        csv.write_text("name,url\nHill,https://example.org/a.gpx\n")
        uploader.record(self.progress, key=uploader.row_key(uploader.SITE, "Hill", "https://example.org/a.gpx"), status="published")
        with patch.dict(sys.modules, {"playwright.sync_api": None}):
            self.assertEqual(uploader.main(["--csv", str(csv), "--progress", str(self.progress)]), 0)

    @patch.object(uploader.time, "sleep")
    @patch.object(uploader, "upload_with_retries", return_value=("quota_limited", "Daily quota reached"))
    def test_quota_stops_batch_and_leaves_rows_resumable(self, upload, sleep) -> None:
        csv = Path(self.temp.name) / "routes.csv"
        csv.write_text("name,url\nFirst,https://example.org/a.gpx\nSecond,https://example.org/b.gpx\n")
        sync_api = types.ModuleType("playwright.sync_api")
        sync_api.sync_playwright = MagicMock()
        with patch.dict(sys.modules, {"playwright.sync_api": sync_api}):
            self.assertEqual(uploader.main(["--csv", str(csv), "--progress", str(self.progress)]), 1)
        upload.assert_called_once()
        sleep.assert_not_called()
        self.assertEqual(uploader.completed(self.progress), set())
        self.assertIn('"status": "quota_limited"', self.progress.read_text())

    @patch.object(uploader.time, "sleep")
    @patch.object(uploader, "upload_one", side_effect=RuntimeError("Network interrupted"))
    @patch.object(uploader, "download", return_value=b"gpx")
    def test_ten_retries_make_eleven_attempts_and_cap_backoff(self, download, upload, sleep) -> None:
        status, message = self.run_row()
        self.assertEqual(status, "failed")
        self.assertIn("11 attempts", message)
        self.assertEqual(upload.call_count, 11)
        download.assert_called_once_with("https://example.org/a.gpx", 180)
        self.assertEqual([call.args[0] for call in sleep.call_args_list],
                         [30, 60, 120, 240, 300, 300, 300, 300, 300, 300])
        self.assertEqual(len(self.progress.read_text().splitlines()), 10)
        self.assertEqual(uploader.completed(self.progress), set())

    @patch.object(uploader.time, "sleep")
    @patch.object(uploader, "upload_one", side_effect=[RuntimeError("Timeout"), ("published", "Done")])
    @patch.object(uploader, "download", return_value=b"gpx")
    def test_upload_retry_reuses_downloaded_bytes_and_stops_on_success(self, download, upload, sleep) -> None:
        self.assertEqual(self.run_row(), ("published", "Done"))
        download.assert_called_once()
        self.assertEqual(upload.call_count, 2)
        self.assertTrue(all(call.args[3] == b"gpx" for call in upload.call_args_list))
        sleep.assert_called_once_with(30)

    @patch.object(uploader.time, "sleep")
    @patch.object(uploader, "upload_one", return_value=("published", "Done"))
    @patch.object(uploader, "download", side_effect=[OSError("Connection lost"), b"gpx"])
    def test_failed_download_is_retried_before_upload(self, download, upload, sleep) -> None:
        self.assertEqual(self.run_row(), ("published", "Done"))
        self.assertEqual(download.call_count, 2)
        upload.assert_called_once()
        sleep.assert_called_once_with(30)

    @patch.object(uploader.time, "sleep")
    @patch.object(uploader, "upload_one", side_effect=[RuntimeError("Response lost"), ("duplicate", "Already published")])
    @patch.object(uploader, "download", return_value=b"gpx")
    def test_duplicate_on_retry_finishes_without_another_publish(self, download, upload, sleep) -> None:
        self.assertEqual(self.run_row(), ("duplicate", "Already published"))
        self.assertEqual(upload.call_count, 2)
        download.assert_called_once()
        sleep.assert_called_once_with(30)

    @patch.object(uploader.time, "sleep")
    @patch.object(uploader, "upload_one", side_effect=RuntimeError("Unavailable"))
    @patch.object(uploader, "download", return_value=b"gpx")
    def test_initial_retry_delay_is_also_capped(self, download, upload, sleep) -> None:
        self.assertEqual(self.run_row(retries=1, retry_delay=600)[0], "failed")
        sleep.assert_called_once_with(300)

    @patch.object(uploader.time, "sleep")
    @patch.object(uploader, "upload_one", side_effect=RuntimeError("Unavailable"))
    @patch.object(uploader, "download", return_value=b"gpx")
    def test_zero_retries_attempts_once_without_waiting(self, download, upload, sleep) -> None:
        self.assertEqual(self.run_row(retries=0)[0], "failed")
        upload.assert_called_once()
        sleep.assert_not_called()

    @patch.object(uploader.time, "sleep")
    @patch.object(uploader, "upload_with_retries", side_effect=[("failed", "Exhausted"), ("published", "Done")])
    def test_main_defaults_to_ten_retries_and_continues_after_failure(self, upload, sleep) -> None:
        csv = Path(self.temp.name) / "routes.csv"
        csv.write_text("name,url\nFirst,https://example.org/a.gpx\nSecond,https://example.org/b.gpx\n")
        sync_api = types.ModuleType("playwright.sync_api")
        sync_api.sync_playwright = MagicMock()
        playwright = sync_api.sync_playwright.return_value.__enter__.return_value
        browser = playwright.chromium.launch.return_value
        context = browser.new_context.return_value
        with patch.dict(sys.modules, {"playwright.sync_api": sync_api}):
            result = uploader.main(["--csv", str(csv), "--progress", str(self.progress)])
        self.assertEqual(result, 1)
        self.assertEqual([call.args[2] for call in upload.call_args_list], ["First", "Second"])
        self.assertTrue(all(call.kwargs["retries"] == 10 for call in upload.call_args_list))
        self.assertIn(uploader.row_key(uploader.SITE, "Second", "https://example.org/b.gpx"),
                      uploader.completed(self.progress))
        context.close.assert_called_once()
        browser.close.assert_called_once()


@unittest.skipUnless(os.environ.get("HILLGPX_BROWSER_TEST"), "Set HILLGPX_BROWSER_TEST=1 with the dev server running")
class RealBrowserTests(unittest.TestCase):
    def test_real_gpx_anonymous_publish_with_mocked_backend(self) -> None:
        from playwright.sync_api import sync_playwright
        payloads = []
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(service_workers="block")
            context.set_default_timeout(60000)

            def intercept(route):
                request = route.request
                if "/data/routes.json" in request.url:
                    route.fulfill(json={"routes": []})
                elif "supabase.co" in request.url:
                    if request.method == "POST" and "/rest/v1/routes" in request.url:
                        payloads.append(request.post_data_json)
                        route.fulfill(status=201, body="")
                    elif request.method not in ("GET", "HEAD", "OPTIONS"):
                        route.fulfill(status=200, json={})
                    else:
                        route.fulfill(json=[])
                elif request.method not in ("GET", "HEAD", "OPTIONS"):
                    route.abort()
                else:
                    route.continue_()

            context.route("**/*", intercept)
            page = context.new_page()
            raw = (Path(__file__).resolve().parent.parent / "data/routes/hong-kong-trail-section-2.gpx").read_bytes()
            self.assertEqual(uploader.upload_one(page, "http://localhost:5180", "CSV browser test", raw, True)[0], "validated")
            self.assertEqual(payloads, [])
            self.assertEqual(uploader.upload_one(page, "http://localhost:5180", "CSV browser test", raw, False)[0], "published")
            self.assertEqual(len(payloads), 1)
            self.assertEqual(payloads[0]["name"], "CSV browser test")
            self.assertTrue(payloads[0]["anonymous"])
            self.assertIsNone(payloads[0]["contributor"])
            self.assertEqual(payloads[0]["licence"], "CC BY 4.0")
            self.assertTrue(payloads[0]["gpx_path"].endswith(".gpx.gz"))
            self.assertGreater(len(payloads[0]["points"]), 2)
            context.close()
            browser.close()


if __name__ == "__main__":
    unittest.main()
