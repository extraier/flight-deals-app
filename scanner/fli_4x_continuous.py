#!/usr/bin/env python3
"""
Continuous calendar scanner — runs the HKG and SZX 4× scans in a gentle
endless loop with 60s between routes and 10 min between full cycles.

Replaces the fixed 4×/day scheduler (fli_scheduler_4x.py) which fires at
UTC 0/6/12/18 (HKT 8/14/20/02) and was over-bursty on Google.

Per-cycle timing (one full HKG scan = 50 routes):
  - 60s between routes  → 50 × 60s = 50 min per cycle
  - 10 min between cycles
  - so one HKG cycle + one SZX cycle = ~110 min, repeated forever
  - = ~26 cycles/day per airport, ~13 each (alternating)

Rate vs old 4×/day:
  - Old: 4 cycles × 50 routes = 200 route-hits/day, all in 1 burst
  - New: 26 cycles × 50 routes = 1300 route-hits/day, spread over 24h
  - Per-request rate: 1 req / 60s = 0.017 rps, very safe

Crash safety:
  - If a scan script exits non-zero, log and sleep 30 min before retry
  - If we OOM, the supervisor restarts us (preserves DB connections, no leaks)

Logs:
  - /data/fli_4x_continuous.log  (this script)
  - /data/fli_4x.log             (HKG scan output, untouched)
  - /data/fli_4x_szx.log         (SZX scan output, untouched)
"""
import os
import subprocess
import sys
import time
from datetime import datetime

# Hermes: TZ must be set for human-friendly log timestamps. The container has
# no /usr/share/zoneinfo (stripped to save image size), so we use the POSIX
# TZ format CST-8 (China Standard Time, UTC+8) instead of Asia/Hong_Kong.
# (set in the supervisor script that wraps this file)
os.environ.setdefault('TZ', 'CST-8')
time.tzset() if hasattr(time, 'tzset') else None  # POSIX only

# Per-route delay (seconds). The scan script reads this env var.
ROUTE_DELAY_SECONDS = '60'

# Inter-cycle pause (seconds). 10 min between HKG and SZX.
INTER_CYCLE_PAUSE = 600

# Backoff after a crash (seconds). 30 min to let Google cool down.
CRASH_BACKOFF = 1800

HKG_SCRIPT = '/data/fli_4x_daily.py'
SZX_SCRIPT = '/data/fli_4x_daily_szx.py'
HKG_EXPORT_SCRIPT = '/data/export_all_dates_hkg_v2.py'
SZX_EXPORT_SCRIPT = '/data/export_all_dates_szx.py'
LOG_FILE = '/data/fli_4x_continuous.log'

# Map: scan label → matching export script. After every successful scan cycle,
# the matching export runs so /data/all_dates*.json (consumed by the web app)
# gets the freshest prices. This means the web app sees updates within ~50 min
# of the most recent price for that airport.
EXPORT_MAP = {
    'HKG': HKG_EXPORT_SCRIPT,
    'SZX': SZX_EXPORT_SCRIPT,
}

DEPARTURES = [
    ('HKG', HKG_SCRIPT),
    ('SZX', SZX_SCRIPT),
]


def now():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def log(msg):
    line = f'[{now()}] {msg}'
    print(line, flush=True)
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(line + '\n')
    except Exception as e:
        print(f'log write failed: {e}', file=sys.stderr, flush=True)


def run_scan(label, script):
    """Run one scan script. Returns True on success, False on crash."""
    env = os.environ.copy()
    env['ROUTE_DELAY_SECONDS'] = ROUTE_DELAY_SECONDS
    log(f'--- {label} cycle starting (route_delay={ROUTE_DELAY_SECONDS}s) ---')

    start = time.time()
    try:
        result = subprocess.run(
            [sys.executable, '-u', script],
            env=env,
            check=False,
            timeout=7200,  # 2h hard cap per cycle (50 routes × 60s = 50 min, leave headroom)
        )
        duration = time.time() - start
        if result.returncode == 0:
            log(f'--- {label} cycle OK ({duration/60:.1f} min) ---')
            return True
        else:
            log(f'--- {label} cycle CRASHED exit={result.returncode} ({duration/60:.1f} min) ---')
            return False
    except subprocess.TimeoutExpired:
        log(f'--- {label} cycle TIMEOUT after 2h — killing ---')
        return False
    except Exception as e:
        log(f'--- {label} cycle EXCEPTION: {e} ---')
        return False


def run_export(label):
    """Export fresh JSON for the just-completed scan. Non-fatal if it fails."""
    export_script = EXPORT_MAP.get(label)
    if not export_script:
        log(f'--- no export script mapped for {label} ---')
        return

    if not os.path.exists(export_script):
        log(f'--- export script missing: {export_script} ---')
        return

    log(f'--- {label} export starting: {export_script} ---')
    start = time.time()
    try:
        result = subprocess.run(
            [sys.executable, '-u', export_script],
            check=False,
            timeout=300,  # 5 min hard cap
        )
        duration = time.time() - start
        if result.returncode == 0:
            log(f'--- {label} export OK ({duration:.1f}s) ---')
        else:
            # Non-fatal: scan data is already in DB, web app just sees stale JSON
            # until next cycle. Don't trigger crash backoff.
            log(f'--- {label} export FAILED exit={result.returncode} ({duration:.1f}s) — JSON stale until next cycle, DB is fresh ---')
    except subprocess.TimeoutExpired:
        log(f'--- {label} export TIMEOUT after 5 min ---')
    except Exception as e:
        log(f'--- {label} export EXCEPTION: {e} ---')


def main():
    log('=' * 60)
    log('FLI CONTINUOUS CALENDAR SCANNER STARTED')
    log(f'Route delay: {ROUTE_DELAY_SECONDS}s | Inter-cycle pause: {INTER_CYCLE_PAUSE}s')
    log(f'Crash backoff: {CRASH_BACKOFF}s | Departures: {[d[0] for d in DEPARTURES]}')
    log('=' * 60)

    cycle = 0
    while True:
        cycle += 1
        log(f'=== CYCLE #{cycle} starting ===')

        for label, script in DEPARTURES:
            ok = run_scan(label, script)
            if not ok:
                log(f'crash detected, backing off {CRASH_BACKOFF}s ({CRASH_BACKOFF/60:.0f} min)')
                time.sleep(CRASH_BACKOFF)
                # Re-loop without the inter-cycle pause, to retry the failed one
                break
            else:
                # Always export fresh JSON after a successful cycle so the web
                # app sees the latest prices. Non-fatal if the export itself fails.
                run_export(label)
                log(f'sleeping {INTER_CYCLE_PAUSE}s ({INTER_CYCLE_PAUSE/60:.0f} min) before next cycle')
                time.sleep(INTER_CYCLE_PAUSE)
        else:
            # All departures succeeded, continue to next cycle
            continue


if __name__ == '__main__':
    main()
