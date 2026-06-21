# Flight Scanner Scripts

Python scripts that run on the Ugreen NAS (`192.168.50.35`) in Docker containers.
They scan Google Flights for cheap HKG and SZX departures and write the results to a
shared SQLite database (`/data/fli_calendar.db`). The web app in this repo reads
the exported JSONs.

## Architecture

| Script | Container | Role |
|---|---|---|
| `fli_scheduler_4x.py` | `fli-scheduler` | Master cron — runs the 4× daily scan at 06:00 / 12:00 / 18:00 / 00:00 HKT |
| `fli_4x_daily.py` | `fli-scheduler` (invoked) | HKG → 50+ routes calendar scan |
| `fli_4x_daily_szx.py` | `fli-scheduler` (invoked) | SZX → 50+ routes calendar scan |
| `fli_detail_scan_aggressive.py` | `fli-detail-hkg` | HKG detail (airline, times) per date |
| `fli_detail_scan_szx.py` | `fli-detail-szx` | SZX detail (airline, times) per date |
| `export_all_dates_hkg_v2.py` | `fli-scheduler` | Exports HKG DB rows → `/data/all_dates.json` |
| `export_all_dates_szx.py` | `fli-scheduler` | Exports SZX DB rows → `/data/all_dates_szx.json` |

## Sync → Vercel

`~/sync_flightdeals.sh` (on the Mac) pulls the exported JSONs from the NAS
container every 5 min (self-throttled to once per 50 min to stay under
Vercel's 100 deploys/day limit), commits them, and pushes to GitHub. Vercel
auto-redeploys on push to `main`.

## Concurrency model

All writers share **one** SQLite database. To avoid lock contention we use:

1. **WAL journal mode** — enabled once on the DB with `PRAGMA journal_mode=WAL`.
   Persistent (stored in DB header). Allows concurrent readers + 1 writer.
2. **`timeout=30`** on every `sqlite3.connect()` — Python waits up to 30 s for
   the lock before raising.
3. **`PRAGMA busy_timeout = 30000`** — belt-and-suspenders SQLite-level timeout
   applied immediately after every `connect()`.

## Deploy / sync

These scripts are **not auto-deployed** from GitHub to the NAS directly, but
`sync_scanner_to_nas.sh` keeps them in sync:

```bash
# Mac copies live in ~/ (e.g. ~/fli_4x_daily_szx.py)
# NAS copies live in /volume1/flight-scanner/

# sync_scanner_to_nas.sh (Mac → NAS):
#   - MD5-checks every script (skip if identical)
#   - cat-over-ssh to push (scp is flaky from this Mac)
#   - restarts only the affected containers
#   - logs to /tmp/scanner_sync.log (auto-trimmed to last 2000 lines)
#   - launchd runs it every 5 min via com.comparetiger.scanner-sync.plist

# To install on a new Mac:
ln -sf "$PWD/sync_scanner_to_nas.sh" ~/sync_scanner_to_nas.sh
cp com.comparetiger.scanner-sync.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.comparetiger.scanner-sync.plist
# (`ln -sf` so a `git pull` that updates the repo file also updates ~/)

# To force a one-off sync:
~/sync_scanner_to_nas.sh
```

Manual override (skips the MD5 check, always pushes + restarts):

```bash
scp -i ~/.ssh/ugreen_nas ~/fli_4x_daily_szx.py openclaw@192.168.50.35:/volume1/flight-scanner/
ssh -i ~/.ssh/ugreen_nas openclaw@192.168.50.35 "docker restart fli-scheduler fli-detail-hkg fli-detail-szx"
```
