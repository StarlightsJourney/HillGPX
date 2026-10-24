# Bulk uploads

## Upload a CSV directly to production


`upload_gpx_csv.py` opens the site's normal **Add a GPX** form in a fresh,
unsigned browser and publishes each file anonymously. It reuses the production
parser, terrain fallback, duplicate checks, compression, API and thumbnail flow.
No account, API key or `.env.local` is needed. This publishes community routes;
it does not add files to the repository. Only supply tracks you may redistribute
under **CC BY 4.0**, which is the upload form's licence.

Install in a virtual environment outside the repository:

```bash
python3 -m venv /tmp/hillgpx-uploader-venv
/tmp/hillgpx-uploader-venv/bin/pip install playwright
/tmp/hillgpx-uploader-venv/bin/python -m playwright install chromium
```

Make a UTF-8 CSV (quote names containing commas):

```csv
name,url
Bukit Timah loop,https://your-host.example/bukit-timah.gpx
"Ridge, out and back",https://your-host.example/ridge.gpx
```

Links must download GPX files directly, without a login. Route pages and share
pages that return HTML are not supported. Files are downloaded to memory (60 MB
maximum); nothing is saved under `data/`.

```bash
# Download, parse and profile every file; browser writes are blocked.
/tmp/hillgpx-uploader-venv/bin/python "bulk uploads/upload_gpx_csv.py" --csv /path/routes.csv --dry-run

# Publish to https://hillgpx.com anonymously.
/tmp/hillgpx-uploader-venv/bin/python "bulk uploads/upload_gpx_csv.py" --csv /path/routes.csv
```

Use `--headed` to watch, or `--site http://localhost:5180` to test a local build.
Downloads, page loading and GPX form processing each allow up to 10 minutes by
default. Use `--timeout 900` for 15 minutes per operation on slower connections.
Activity is inferred by the normal form. Names must be 1–120 characters. Uploads
are sequential with a 370-second gap (`--delay`). The anonymous server limits
are **10 routes per rolling hour and 30 per rolling day per connection**, plus
site-wide storage/contribution limits. The default gap leaves a little margin
under the hourly limit; the daily limit still applies, including earlier uploads
from the same connection. Quota errors **stop the entire batch immediately**,
leaving the current and remaining rows available for resume. Wait for the quota
to reset (up to 24 hours; the server does not distinguish hourly from daily
connection limits), then rerun with the same progress log. Retrying every few
seconds or changing networks is not a reliable fix.

Other failed rows get **10 automatic retries after the first
attempt** (11 attempts total), for download or upload failures. `--retries N`
changes the retry count. `--retry-delay 30` sets the initial wait; it doubles on
each failure up to five minutes. Every retry reopens the normal import flow,
including duplicate checks. Successfully downloaded bytes are reused. After
exhausting a row's attempts, the failure is logged and the next row is attempted.
The exit status is nonzero if any download or upload failed.

The printed JSONL progress path defaults to OS temp (`hillgpx-<hash>.jsonl`,
stable for the CSV path and site). Re-run the same command to skip rows already
published or detected as duplicates. `--progress /tmp/hillgpx-my-batch.jsonl`
chooses another log. Keep the log for as long as you need resume support; OS temp
may be cleared. Dry runs recheck all rows and do not mark them published. A
connection loss after a write may leave an uncertain result; on resume, the
site's track duplicate detection prevents a second copy. Do not run concurrent
uploaders against the same progress log. Thumbnail rendering is best effort,
as it is for manual uploads; cards can render their basemap live if it fails.

For the existing curated batch, use its existing `progress` log explicitly
(from this directory):

```bash
/tmp/hillgpx-uploader-venv/bin/python upload_gpx_csv.py --csv hillgpx_curated_routes.csv --progress progress
```

An entirely completed batch exits before launching a browser or downloading
anything. Earlier failure/retry entries do not override later successes. New
logs belong in OS temp, as above; keep the existing log for resume purposes.
DNS errors such as `nodename nor servname provided, or not known` are GPX source
download failures: check your internet connection and that source hostname.

Maintenance note (2026-10-24): upload failures were traced to the 10/hour and
30/day quotas in `supabase/migrations/20261006000000_spam_limits.sql`, combined
with the old 10-second uploader gap. No backend limit changes are needed.

Uploader checks:

```bash
python3 -m unittest discover -s "bulk uploads" -p test_upload_gpx_csv.py -v
# With npm run dev running and Python Playwright installed:
HILLGPX_BROWSER_TEST=1 python3 -m unittest discover -s "bulk uploads" -p test_upload_gpx_csv.py -v
```

The optional browser test uses a committed real GPX and intercepts backend
requests, including all writes, so it never creates a production route.


## Upload browser through Tor

Install the Tor daemon on macOS with Homebrew ([Tor installation guide](https://support.torproject.org/little-t-tor/getting-started/installing/)):

```bash
brew install tor
tor --DataDirectory /tmp/hillgpx-tor --SocksPort 9050
```

Keep Tor running and wait until it reports `Bootstrapped 100%`. In a second
terminal, activate your Python virtual environment, then from `bulk uploads`:

```bash
python3 upload_gpx_csv.py --csv hillgpx_curated_routes.csv --tor
```

`--tor` uses `socks5://127.0.0.1:9050`. For a different SOCKS listener:

```bash
python3 upload_gpx_csv.py --csv hillgpx_curated_routes.csv --tor socks5://127.0.0.1:9150
```

The script checks the SOCKS5 listener before starting Chromium. All upload
browser traffic (including the site, Supabase uploads and thumbnails) uses that
proxy; a failed proxy connection does not fall back to a direct connection.
Python's GPX source downloads still use your normal connection. This is an
upload transport option, not a full anonymity guarantee or a guarantee against
rate limits: Tor exits can be shared, blocked or already limited. The existing
retry/backoff and production quotas still apply. The script uses the running
Tor service's circuits; it does not manage that service.
