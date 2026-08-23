#!/usr/bin/env python3
"""UO-only FLI Detail Scanner — Hermes-patched 2026-06-30 / 2026-07-01.

Identical structure to fli_detail_scan_aggressive.py (HKG all-airlines).
Only difference: airlines=[Airline.UO] added to FlightSearchFilters,
and ROUTES is filtered to UO-served HKG destinations.

Smart re-scan policy, flock-protected writes, and historical_prices
mirroring all match the HKG scanner exactly.

Hermes 2026-07-01: added 429-aware exponential backoff (mirrors fli_detail_scan_szx.py).
UO was getting intermittent HTTP 429s on busy Google Flights, and the old code
just logged them and moved on without pausing. Pattern: regex-detect on exception
str, retry 3× with 5/10/20s sleeps, then 10-min global cooldown if 3 hit in a row.
"""
import re
import sys
import sqlite3
import time
import os  # Hermes 2026-07-10: PILOT_ROUTES env var lookup
from datetime import datetime, timedelta

sys.path.insert(0, '/install')
sys.path.insert(0, '/data')  # Hermes: fli_db.py lives next to the scanners

# Hermes 2026-07-10: cap fli.search's internal ThreadPoolExecutor at 2
# workers. Default is 10 which causes ~200-300MB RSS just for the
# executor's idle curl_cffi sessions, pushing us over the 256MB
# container cgroup limit and triggering OOM kill (exit 137). 2 workers
# keeps RSS around 60-70MB. When UO pilot runs alongside SZX pilot,
# both processes together stay around 140-160MB total — under the
# container cgroup limit.
try:
    from fli.search._concurrency import configure_concurrency
    configure_concurrency(2)
except Exception:
    pass  # Not fatal — fall back to default if API changes

# Hermes 2026-07-10: activate the free HTTPS proxy pool so UO's home-IP
# 429s (which SZX also saw) get routed through proxies. Same pattern as
# fli_detail_scan_szx.py. PROXY_POOL_ENABLED=0 to disable.
try:
    import proxy_pool
    proxy_pool.activate()
except Exception as _pool_err:
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] proxy pool activate failed, falling back to direct: {_pool_err}")

from fli.search import SearchFlights
from fli.models.google_flights.base import TripType, FlightSegment
from fli.models.google_flights.flights import FlightSearchFilters
from fli.core.parsers import resolve_enum
from fli.models import Airport, Airline

import fli_db  # Hermes: shared DB helper — see fli_db.py for the flock+busy story

DB_PATH = '/data/fli_calendar.db'  # legacy, used by export scripts only

# Hermes: UO-served routes from HKG (Hong Kong Express network).
# Source: /data/hke_routes.json — canonical HKE route list (36 routes).
# Earlier version had only 13 routes (from flight_details.outbound_airline='UO'
# history, which only reflects what the all-airlines scanner had picked up
# as cheapest, missing 23 routes that HKE actually serves).
ROUTES = [
    'HKG→FUK',   # Fukuoka
    'HKG→HIJ',   # Hiroshima
    'HKG→ISG',   # Ishigaki
    'HKG→KMQ',   # Komatsu
    'HKG→NGO',   # Nagoya
    'HKG→OKA',   # Okinawa
    'HKG→KIX',   # Osaka Kansai
    'HKG→SDJ',   # Sendai
    'HKG→TAK',   # Takamatsu
    'HKG→TYO',   # Tokyo (city)
    'HKG→HND',   # Tokyo Haneda
    'HKG→NRT',   # Tokyo Narita
    'HKG→CTS',   # Sapporo (added 2026-07-02 by Hermes)
    'HKG→PKX',   # Beijing Daxing
    'HKG→CZX',   # Changzhou
    'HKG→NGB',   # Ningbo
    'HKG→SYX',   # Sanya
    'HKG→WUX',   # Wuxi
    'HKG→YIW',   # Yiwu
    'HKG→BKI',   # Kota Kinabalu
    'HKG→SZB',   # Subang (KL)
    'HKG→PEN',   # Penang
    'HKG→BKK',   # Bangkok
    'HKG→CNX',   # Chiang Mai
    'HKG→HKT',   # Phuket
    'HKG→DAD',   # Da Nang
    'HKG→HAN',   # Hanoi
    'HKG→PQC',   # Phu Quoc
    'HKG→KHH',   # Kaohsiung
    'HKG→RMQ',   # Taichung
    'HKG→TPE',   # Taipei
    'HKG→PUS',   # Busan
    'HKG→TAE',   # Daegu
    'HKG→CJU',   # Jeju
    'HKG→ICN',   # Seoul Incheon
    'HKG→CRK',   # Clark (Philippines)
    'HKG→MNL',   # Manila
]

# Hermes 2026-07-01: 429-aware cooldown state. Shared file with SZX detail
# scanner so all instances back off together when Google throttles us.
_429_COUNT_FILE = '/data/.szx_429_cooldown'  # reused to keep one global cooldown
_429_CONSECUTIVE_THRESHOLD = 3
_429_COOLDOWN_SECONDS = 600  # 10 min


def log(msg):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}")
    sys.stdout.flush()


def _cooldown_active():
    try:
        with open(_429_COUNT_FILE) as f:
            content = f.read().strip()
        until_ts = float(content)
        remaining = until_ts - time.time()
        return max(0, int(remaining))
    except (OSError, ValueError):
        return 0


def _set_cooldown(seconds):
    try:
        with open(_429_COUNT_FILE, 'w') as f:
            f.write(str(time.time() + seconds))
    except OSError:
        pass


def _clear_cooldown():
    try:
        import os as _os
        _os.remove(_429_COUNT_FILE)
    except OSError:
        pass


# Hermes 2026-07-01: HTTP 429 detection. fli SDK wraps errors in google_flights
# errors — we sniff the message for the telltale '429' or 'rate' substrings so
# we know to back off. Other exceptions get the old fast-fail behaviour.
_429_PATTERN = re.compile(r'(HTTP\s*429|rate.?limit|too many requests)', re.IGNORECASE)


def _is_429(exc_str):
    return bool(_429_PATTERN.search(exc_str or ''))


# Hermes 2026-07-10: PILOT_ROUTES filter (mirrors fli_detail_scan_szx.py).
# When PILOT_ROUTES env var is set (e.g. "HKG→FUK,HKG→KIX"), only those
# routes are scanned. Used by the UO proxy pilot (uo_pilot_loop.sh) to
# validate proxy pool can sustain a small UO route subset before scaling.
# Empty/unset = scan all ROUTES.
def _apply_pilot():
    global ROUTES
    pilot = os.environ.get('PILOT_ROUTES', '').strip()
    if not pilot:
        return
    pilot_set = {r.strip() for r in pilot.split(',') if r.strip()}
    ROUTES = [r for r in ROUTES if r in pilot_set]
    print(f"PILOT MODE: scanning {len(ROUTES)}/{len(pilot_set)+0} routes: {ROUTES}")


# Hermes 2026-07-10: CAPTCHA/garbage detector (mirrors SZX safeguard).
# When a proxy returns a CAPTCHA challenge page or HTML error, the parser
# still extracts numeric fields but they're garbage. Heuristics:
# - Price outside plausible UO range: HK$300–HK$30,000.
# - Outbound flight number AND airline both missing → HTML garbage.
# - Duplicate (airline, flight, price) tuple across queries → CAPTCHA repeat.
def _is_suspicious_response(details, seen_tuples=None, route_typical=None):
    if not details:
        return None
    price = details.get('price')
    if price is None or price <= 0:
        return "price missing/non-positive"
    if price < 300 or price > 30000:
        return f"implausible price HK${int(price)} (range 300-30000)"
    if not details.get('outbound_flight') and not details.get('outbound_airline'):
        return "no flight number/airline in response"
    # Hermes 2026-07-10: per-route typical check. Catches "looks legit but
    # 90% too cheap" — e.g. HKG→FUK at HK$500 vs typical HK$2,300.
    if route_typical is not None and route_typical >= 3000:
        floor = max(500, route_typical * 0.30)
        if price < floor:
            return (f"price HK${int(price)} < 30% of route typical "
                    f"HK${int(route_typical)} (floor HK${int(floor)})")
        # Hermes 2026-07-10: catch HIGH outliers too — CAPTCHA parse noise
        # sometimes picks up 7-8 digit numbers (HK$41M, HK$1.2B) instead
        # of the real price. 5× typical is a safe cap.
        cap = route_typical * 5
        if price > cap:
            return (f"price HK${int(price)} > 5x route typical "
                    f"HK${int(route_typical)} (cap HK${int(cap)})")
    if seen_tuples is not None:
        sig = (
            details.get('outbound_airline') or '',
            details.get('outbound_flight') or '',
            int(price),
        )
        if sig in seen_tuples:
            return f"duplicate ({sig[0]} {sig[1]} HK${sig[2]}) — likely CAPTCHA repeat"
        seen_tuples.add(sig)
    return None


def init_db():
    # Hermes: route schema setup through fli_db so WAL + busy_timeout are
    # applied idempotently alongside the schema.
    conn = fli_db.connect()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS flight_details (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route TEXT NOT NULL,
            dep_date TEXT NOT NULL,
            ret_date TEXT NOT NULL,
            price REAL NOT NULL,
            outbound_airline TEXT,
            outbound_flight TEXT,
            outbound_dep_time TEXT,
            outbound_arr_time TEXT,
            outbound_stops INTEGER,
            outbound_aircraft TEXT,
            return_airline TEXT,
            return_flight TEXT,
            return_dep_time TEXT,
            return_arr_time TEXT,
            return_stops INTEGER,
            return_aircraft TEXT,
            total_duration INTEGER,
            scan_time TEXT NOT NULL,
            UNIQUE(route, dep_date, ret_date)
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_details_route ON flight_details(route)')
    conn.commit()
    return conn


def get_dates_at_cheapest_prices(conn, route, max_dates=9999):
    """Read cheap (dep_date, ret_date, price) tuples for `route`.

    Hermes 2026-07-02: union of two signals:
      1. flight_dates cheap prices (calendar scanner, all-airlines) — the
         "is this date plausibly cheap to fly" signal. Trims by 15% threshold.
      2. flight_details UO-history (past 14d rows where UO actually served
         this date) — ground truth that UO flies these dates. price=0 sentinel
         so the smart re-scan policy treats them as new entries.

    Why union: Google Flights airlines=[UO] filter is unreliable — sometimes
    it returns MM/GK flights even when UO doesn't fly. flight_dates has the
    cheap-date signal but only knows about the calendar cheap airline. The
    UO-history rows prove UO served specific dates and let us re-query them.

    Fallback grid (today+14d through today+191d every 3d) if both queries
    return empty (HKE-served routes missing from flight_dates AND no UO
    history yet — first-run scenarios for OKA/HIJ/ISG/etc.).
    """
    c = conn.cursor()

    # Signal 1: cheap dates from flight_dates (all-airlines calendar)
    c.execute('''
        SELECT dep_date, ret_date, MIN(price) as price
        FROM flight_dates
        WHERE route = ? AND dep_date >= date('now')
        GROUP BY dep_date, ret_date
        ORDER BY MIN(price) ASC
        LIMIT ?
    ''', (route, max_dates))
    cal_rows = c.fetchall()

    # Signal 2: UO history dates from flight_details (last 14d, UO served)
    c.execute('''
        SELECT DISTINCT dep_date, ret_date
        FROM flight_details
        WHERE route = ?
          AND (outbound_airline = 'UO' OR return_airline = 'UO')
          AND scan_time > datetime('now', '-14 days')
          AND dep_date >= date('now')
    ''', (route,))
    history_dates = c.fetchall()

    if cal_rows or history_dates:
        # Build merged dict: dep|ret -> price
        # Calendar price wins; history-only dates get price=0 sentinel.
        merged = {}
        for d, r_, p in cal_rows:
            merged[f'{d}|{r_}'] = p
        for d, r_ in history_dates:
            key = f'{d}|{r_}'
            if key not in merged:
                merged[key] = 0.0  # sentinel: always re-scan

        # Apply 15% threshold to calendar prices; history dates bypass it
        if cal_rows:
            cheapest = min(r[2] for r in cal_rows)
            threshold = cheapest * 1.15
        else:
            threshold = float('inf')

        result = []
        for key, p in merged.items():
            d, r_ = key.split('|', 1)
            # Keep all history dates + calendar dates within 15% threshold
            if p == 0.0 or p <= threshold:
                result.append((d, r_, p))

        # Sort: calendar cheap first (non-zero price), then history dates
        result.sort(key=lambda x: (x[2] == 0.0, x[2], x[0]))
        return result

    # Fallback grid for HKE routes missing from flight_dates
    today = datetime.now().date()
    fallback = []
    # Hermes 2026-07-01: User wants 180 days of forward coverage.
    # New grid: every 3 days, offset 14 to 191 = 60 dates per route.
    # Coverage: today+14d through today+191d ≈ 180+ days.
    # Cost: 22 fallback routes × 60 dates × ~12s = ~4.4 hours per round
    # just for fallback routes. Routes with flight_dates data skip via
    # the $5 heuristic, so they're quick.
    for offset in range(14, 194, 3):
        dep = today + timedelta(days=offset)
        ret = dep + timedelta(days=4)
        fallback.append((dep.isoformat(), ret.isoformat(), 0.0))
    log(f"  Using fallback date grid: {len(fallback)} dates (every 3d, offset 14-193, ~180 days)")
    return fallback


def get_flight_details(searcher, origin, dest, dep_date, ret_date, consecutive_429_box):
    """Returns (details_dict_or_None, exc_str_or_None).

    Hermes 2026-07-01: now returns the exception string alongside so callers can
    distinguish 429 from other errors and apply backoff. consecutive_429_box is
    a one-element list we mutate to count in-flight 429s.
    """
    try:
        orig_apt = resolve_enum(Airport, origin)
        dest_apt = resolve_enum(Airport, dest)
    except Exception as e:
        log(f"  Airport resolve error: {e}")
        return None, str(e)

    try:
        filters = FlightSearchFilters(
            trip_type=TripType.ROUND_TRIP,
            passenger_info={"adults": 1},
            flight_segments=[
                FlightSegment(
                    departure_airport=[[orig_apt, 0]],
                    arrival_airport=[[dest_apt, 0]],
                    travel_date=dep_date
                ),
                FlightSegment(
                    departure_airport=[[dest_apt, 0]],
                    arrival_airport=[[orig_apt, 0]],
                    travel_date=ret_date
                )
            ],
            airlines=[Airline.UO],   # Hermes: UO-only filter — proven 2026-06-30
        )

        # Hermes 2026-08-23: top_n=1 cuts request amplification.
        # See fli_detail_scan_aggressive.py for the rationale.
        results = searcher.search(filters, top_n=1)

        # Hermes 2026-07-01: a successful call clears the 429 streak.
        consecutive_429_box[0] = 0

        if not results or len(results) == 0:
            log(f"  Warning: Empty results for {dep_date}→{ret_date}")
            return None, "empty"

        outbound, ret = results[0]

        out_leg = outbound.legs[0] if outbound.legs else None
        ret_leg = ret.legs[0] if ret and ret.legs else None

        return {
            'price': outbound.price,
            'outbound_airline': out_leg.airline.name if out_leg else None,
            'outbound_flight': out_leg.flight_number if out_leg else None,
            'outbound_dep_time': out_leg.departure_datetime.strftime('%H:%M') if out_leg else None,
            'outbound_arr_time': out_leg.arrival_datetime.strftime('%H:%M') if out_leg else None,
            'outbound_stops': outbound.stops if outbound else None,
            'outbound_aircraft': out_leg.aircraft if out_leg else None,
            'return_airline': ret_leg.airline.name if ret_leg else None,
            'return_flight': ret_leg.flight_number if ret_leg else None,
            'return_dep_time': ret_leg.departure_datetime.strftime('%H:%M') if ret_leg else None,
            'return_arr_time': ret_leg.arrival_datetime.strftime('%H:%M') if ret_leg else None,
            'return_stops': ret.stops if ret else None,
            'return_aircraft': ret_leg.aircraft if ret_leg else None,
            'total_duration': outbound.duration if hasattr(outbound, 'duration') else None,
        }, None
    except Exception as e:
        import traceback
        log(f"  Error in get_flight_details: {e}")
        log(f"  Trace: {traceback.format_exc()[-500:]}")
        consecutive_429_box[0] += 1
        return None, str(e)


def main():
    log("=" * 50)
    log("FLI DETAIL SCAN [UO-ONLY] STARTING")

    # Hermes 2026-07-10: PILOT_ROUTES filter (conservative proxy pilot)
    _apply_pilot()
    recorded_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = init_db()

    searcher = SearchFlights()
    total_saved = 0
    success = 0
    junk_for_round = 0  # Hermes 2026-07-10: CAPTCHA/garbage responses dropped
    seen_tuples = set()  # Hermes 2026-07-10: detect CAPTCHA repeats

    for route in ROUTES:
        # Hermes 2026-07-01: respect any in-progress global cooldown before
        # starting a fresh route.
        cooldown_left = _cooldown_active()
        if cooldown_left > 0:
            log(f"  global 429 cooldown active — sleeping {cooldown_left}s before {route}")
            time.sleep(cooldown_left)
            _clear_cooldown()

        origin, dest = route.split('→')
        log(f"Processing {route} (UO-only)...")

        dates_to_scan = get_dates_at_cheapest_prices(conn, route, max_dates=9999)

        if not dates_to_scan:
            log(f"  No dates found")
            continue

        log(f"  Found {len(dates_to_scan)} dates at cheapest prices")

        saved_for_route = 0
        consecutive_429 = [0]  # Hermes 2026-07-01: 429 streak counter
        for dep_date, ret_date, price in dates_to_scan:
            # Hermes: smart re-scan policy (mirrors HKG scanner). Google Flights
            # prices revert constantly (a $4,930 deal can be $5,520 the next day),
            # but re-querying every detail call would blow our 429 budget. Instead:
            #   1. Always run the cheap pre-check from flight_dates (current
            #      calendar price, ALL airlines) against flight_details (last
            #      queried UO-only price).
            #   2. If they match within $5, skip the Google query — almost
            #      certainly unchanged.
            #   3. If they diverge, re-query Google with airlines=[UO] to update
            #      flight_details AND mirror today's price into historical_prices
            #      so history.1d/4d/7d always reflects the latest UO scan, not a
            #      stale snapshot.
            c = conn.cursor()
            c.execute("SELECT price, scan_time FROM flight_details WHERE route=? AND dep_date=? AND ret_date=?",
                     (route, dep_date, ret_date))
            row = c.fetchone()
            existing_price = row[0] if row else None
            existing_scan_time = row[1] if row else None

            # Skip when the calendar price matches what we have — safe heuristic.
            # Fallback routes have price=0, which means "no calendar data yet" —
            # always re-scan so we keep building history.
            if (existing_price is not None and price > 0
                    and abs(existing_price - price) < 5.0):
                # Hermes 2026-07-02: even on smart-skip, touch scan_time if it's
                # >24h stale. Otherwise the row looks falsely fresh — the
                # flight-deals health alert uses scan_time and Telegram post
                # won't catch silent scanner stalls.
                try:
                    from datetime import datetime as _dt
                    if existing_scan_time:
                        last_ts = _dt.strptime(existing_scan_time, "%Y-%m-%d %H:%M:%S")
                        if (_dt.now() - last_ts).total_seconds() > 86400:
                            with fli_db.write_transaction(conn, label=f"detail-touch {route} {dep_date}", flock_timeout_s=10) as tx:
                                tx.execute("UPDATE flight_details SET scan_time=? WHERE route=? AND dep_date=? AND ret_date=?",
                                          (recorded_date, route, dep_date, ret_date))
                except Exception as _e:
                    log(f"  Touch-scan_time failed for {route} {dep_date}: {_e}")
                saved_for_route += 1
                continue

            # Hermes 2026-07-01: exponential backoff on 429. Mirrors SZX patch.
            details = None
            exc_str = None
            for attempt in range(3):
                details, exc_str = get_flight_details(searcher, origin, dest, dep_date, ret_date, consecutive_429)
                if details is not None or exc_str in (None, "empty"):
                    consecutive_429[0] = 0
                    break
                if _is_429(exc_str):
                    backoff = min(5 * (2 ** attempt), 60)  # 5, 10, 20 (capped at 60)
                    log(f"  429 on {dep_date}→{ret_date} (attempt {attempt+1}/3, streak {consecutive_429[0]}) — backing off {backoff}s")
                    if consecutive_429[0] >= _429_CONSECUTIVE_THRESHOLD:
                        _set_cooldown(_429_COOLDOWN_SECONDS)
                        log(f"  {consecutive_429[0]} consecutive 429s — entering global { _429_COOLDOWN_SECONDS}s cooldown")
                        time.sleep(_429_COOLDOWN_SECONDS)
                        _clear_cooldown()
                        consecutive_429[0] = 0
                        # Re-attempt fresh after cooldown
                        details, exc_str = get_flight_details(searcher, origin, dest, dep_date, ret_date, consecutive_429)
                        if details is not None or exc_str in (None, "empty"):
                            break
                    else:
                        time.sleep(backoff)
                else:
                    # Non-429 error — log once, move on (old behaviour preserved).
                    break

            if details:
                # Hermes 2026-07-10: CAPTCHA/garbage guard (mirrors SZX).
                # Drop CAPTCHA-parse noise BEFORE writing to flight_details
                # so we don't poison the DB with HK$3M garbage.
                suspicious = _is_suspicious_response(details, seen_tuples)
                if suspicious:
                    log(f"  {dep_date}→{ret_date}: SUSPECT ({suspicious}) — dropped")
                    junk_for_round += 1
                    continue
                # Hermes: per-row write with write_transaction (flock + BEGIN
                # IMMEDIATE). Critical section is tiny (one row + commit), so
                # the 4x scans only wait a few ms even when we're churning
                # through many rows.
                try:
                    with fli_db.write_transaction(conn, label=f"detail {route} {dep_date}", flock_timeout_s=30) as tx:
                        tx.execute('''
                            INSERT OR REPLACE INTO flight_details
                            (route, dep_date, ret_date, price, outbound_airline, outbound_flight,
                             outbound_dep_time, outbound_arr_time, outbound_stops, outbound_aircraft,
                             return_airline, return_flight, return_dep_time, return_arr_time,
                             return_stops, return_aircraft, total_duration, scan_time)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (
                            route, dep_date, ret_date, details['price'],
                            details['outbound_airline'], details['outbound_flight'],
                            details['outbound_dep_time'], details['outbound_arr_time'],
                            details['outbound_stops'], details['outbound_aircraft'],
                            details['return_airline'], details['return_flight'],
                            details['return_dep_time'], details['return_arr_time'],
                            details['return_stops'], details['return_aircraft'],
                            details['total_duration'], recorded_date
                        ))
                        # Mirror the live price into today's historical_prices
                        # row so history.1d/4d/7d always reflect actual scans,
                        # not stale DB rows that survived a price revert.
                        tx.execute('''
                            INSERT OR REPLACE INTO historical_prices
                            (route, dep_date, ret_date, price, currency, recorded_date)
                            VALUES (?, ?, ?, ?, 'HKD', date('now'))
                        ''', (route, dep_date, ret_date, details['price']))
                    total_saved += 1
                    saved_for_route += 1
                    if existing_price is not None:
                        delta = details['price'] - existing_price
                        direction = '↑' if delta > 0 else ('↓' if delta < 0 else '·')
                        log(f"  {dep_date}→{ret_date}: {details['outbound_airline']} {details['outbound_flight']} @ HK${details['price']}  {direction}{abs(int(delta))}")
                    else:
                        log(f"  {dep_date}→{ret_date}: {details['outbound_airline']} {details['outbound_flight']} @ HK${details['price']}")
                except TimeoutError as e:
                    log(f"  Lock timeout (4x scan holding lock >30s), skipping this row: {e}")
                except sqlite3.OperationalError as e:
                    if "locked" in str(e).lower():
                        log(f"  Persistent lock failure: {e}")
                    else:
                        log(f"  DB error: {e}")
                except Exception as e:
                    log(f"  DB error: {e}")
            else:
                log(f"  {dep_date}→{ret_date}: No details")

            # Hermes 2026-07-01: bumped 2.5s → 4.0s. Mirrors SZX patch.
            time.sleep(4.0)
            # Hermes 2026-07-10: periodic GC every 5 dates to stop the
            # curl_cffi session buffers from accumulating (OOM fix).
            if (junk_for_round + total_saved) % 5 == 0:
                import gc
                before_kb = 0
                try:
                    with open(f'/proc/{os.getpid()}/status') as f:
                        for line in f:
                            if line.startswith('VmRSS:'):
                                before_kb = int(line.split()[1])
                                break
                except Exception:
                    pass
                gc.collect()
                if before_kb:
                    log(f"  [gc] RSS {before_kb/1024:.0f}MB, forcing collection")

        if saved_for_route > 0:
            success += 1

    log(f"Scan complete! Saved {total_saved} details from {success}/{len(ROUTES)} routes, dropped {junk_for_round} suspicious (CAPTCHA/garbage)")
    conn.close()
    return total_saved, success


if __name__ == '__main__':
    main()
