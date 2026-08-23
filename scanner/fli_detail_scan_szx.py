#!/usr/bin/env python3
"""SZX Detail Scanner - scan flight details for SZX→XXX routes.

Hermes 2026-07-09: SZX routes are the most likely to trip Google's
per-IP rate limit because they're less common and Google treats the
traffic pattern as anomalous. So SZX-only uses the free HTTPS proxy
pool from /data/proxy_pool.py — HKG scan is left untouched and goes
direct via the home IP (fast + already in Google's normal pattern).

To disable the proxy pool temporarily, set environment variable
PROXY_POOL_ENABLED=0 before launching the container.
"""
import os, sys, sqlite3, subprocess, time
from datetime import datetime
sys.path.insert(0, '/install')
sys.path.insert(0, '/data')  # Hermes: fli_db.py + proxy_pool.py live next to the scanners
# Activate free proxy pool before importing fli.search so the
# monkey-patch on fli.search.client.Client._session fires before
# any thread creates its first session.
try:
    import proxy_pool
    proxy_pool.activate()
except Exception as _pool_err:
    # Don't fail the whole scan if the pool can't bootstrap — we'll
    # just fall back to direct connections (current behaviour).
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] proxy pool activate failed, falling back to direct: {_pool_err}")
from fli.search import SearchFlights
from fli.models.google_flights.base import TripType, FlightSegment
from fli.models.google_flights.flights import FlightSearchFilters
from fli.core.parsers import resolve_enum
from fli.models import Airport

import fli_db  # Hermes: shared DB helper — see fli_db.py for the flock+busy story

# Hermes 2026-07-10: cap fli.search's internal ThreadPoolExecutor at 2
# workers. Default is 10 which causes ~200-300MB RSS just for the
# executor's idle curl_cffi sessions, pushing us over the 256MB
# container cgroup limit and triggering OOM kill (exit 137). 2 workers
# keeps RSS around 60-70MB. Token-bucket rate limiter still allows
# 10 req/sec per IP; with rotation across ~6 proxies in the pool,
# total throughput is 60 req/sec — way more than we need.
try:
    from fli.search._concurrency import configure_concurrency
    configure_concurrency(2)
except Exception:
    pass  # Not fatal — fall back to default if API changes

DB_PATH = '/data/fli_calendar.db'  # legacy, used by export scripts only
DEPARTURE = 'SZX'

ROUTES = [
    'SZX→AKL', 'SZX→AMS', 'SZX→BCN', 'SZX→BKK', 'SZX→BOM',
    'SZX→CAI', 'SZX→CAN', 'SZX→CDG', 'SZX→CGK', 'SZX→CMB',
    'SZX→CTS', 'SZX→CTU', 'SZX→DEL', 'SZX→DOH', 'SZX→DPS',
    'SZX→DXB', 'SZX→FCO', 'SZX→FRA', 'SZX→FUK', 'SZX→HAN',
    'SZX→HKT', 'SZX→ICN', 'SZX→JFK', 'SZX→JNB', 'SZX→KHH',
    'SZX→KIX', 'SZX→KUL', 'SZX→LAX', 'SZX→LHR', 'SZX→MAD',
    'SZX→MEL', 'SZX→MNL', 'SZX→NGO', 'SZX→NRT', 'SZX→OKE',
    'SZX→ORD', 'SZX→PEK', 'SZX→PEN', 'SZX→PUS', 'SZX→PVG',
    'SZX→RGN', 'SZX→RMQ', 'SZX→SEA', 'SZX→SFO', 'SZX→SGN',
    'SZX→SIN', 'SZX→SYD', 'SZX→SZX', 'SZX→TPE', 'SZX→XIY', 'SZX→YVR'
]

# Hermes 2026-07-09: PILOT_ROUTES — when set to a comma-separated list of
# SZX→XXX codes (e.g. "SZX→BKK,SZX→SIN"), only those routes are scanned.
# Used by the conservative proxy-pool pilot (see szx_pilot_loop.sh) to
# validate that free proxies can sustain a small number of routes before
# scaling to the full 50. Empty/unset = scan all routes (production mode).
def _apply_pilot():
    global ROUTES
    pilot = os.environ.get('PILOT_ROUTES', '').strip()
    if not pilot:
        return
    pilot_set = {r.strip() for r in pilot.split(',') if r.strip()}
    before = len(ROUTES)
    ROUTES = [r for r in ROUTES if r in pilot_set]
    log(f"PILOT MODE: scanning {len(ROUTES)}/{before} routes: {ROUTES}")

def log(msg):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}")
    sys.stdout.flush()

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
            departure TEXT DEFAULT 'HKG',
            UNIQUE(route, dep_date, ret_date)
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_details_route ON flight_details(route)')
    conn.commit()
    return conn

def get_dates(conn, route, max_dates=9999):
    c = conn.cursor()
    c.execute("SELECT MIN(price) FROM flight_dates WHERE route=? AND dep_date >= date('now') AND departure=?", (route, DEPARTURE))
    min_price = c.fetchone()[0]
    if not min_price:
        return []
    threshold = min_price * 1.15
    c.execute('''
        SELECT dep_date, ret_date, MIN(price) as price
        FROM flight_dates
        WHERE route=? AND dep_date >= date('now') AND departure=? AND price <= ?
        GROUP BY dep_date, ret_date
        ORDER BY price ASC, dep_date ASC
        LIMIT ?
    ''', (route, DEPARTURE, threshold, max_dates))
    return c.fetchall()


def _get_route_typical(route: str) -> float | None:
    """Hermes 2026-07-10: per-route typical price from flight_dates table.

    Returns the median price for the route, or None if the route has too
    few samples (likely new route or never scanned). Used by the CAPTCHA
    safeguard to catch "looks legitimate but price is 90% too cheap"
    cases — the absolute range check (300-30000) misses these.

    flight_dates is the cleaner source (no CAPTCHA parse artifacts have
    been observed there — only flight_details is CAPTCHA-prone). We pull
    from dep_date >= 60 days back so the median reflects current pricing.
    """
    try:
        own_conn = sqlite3.connect(DB_PATH, timeout=10)
        cur = own_conn.cursor()
        cur.execute("""
            SELECT price FROM flight_dates
            WHERE route = ?
              AND dep_date >= date('now', '-60 days')
        """, (route,))
        prices = [row[0] for row in cur.fetchall() if row[0] and row[0] > 0]
        own_conn.close()
        if len(prices) < 10:
            return None
        prices.sort()
        return prices[len(prices) // 2]
    except Exception as e:
        log(f"  _get_route_typical({route}) failed: {e}")
        return None


def _is_suspicious_response(details: dict, seen_tuples: set | None = None,
                             route_typical: float | None = None) -> str | None:
    """Hermes 2026-07-09: CAPTCHA / proxy-garbage detector.

    When a proxy returns a CAPTCHA challenge page or HTML error, the parser
    still extracts numeric fields but they're garbage. This function returns
    a reason string if the details look fishy, or None if plausible.

    Heuristics (ordered cheap → expensive):
    - Price outside plausible SZX range: HK$300–HK$30,000.
    - Outbound flight number is missing (parser failed silently).
    - Outbound dep_time missing (parser failed silently).
    - (airline, flight, price) tuple already seen this round — CAPTCHA
      pages return the same canned "result" for different queries, so
      duplicates are a strong signal of garbage.
    - Price < 30% of per-route typical AND typical >= HK$3,000. Catches
      the "looks legitimate but price is 90% too cheap" case that the
      range check alone misses (e.g. SZX→AMS HK$749 vs typical HK$7,802).
    """
    if not details:
        return None  # empty result is not necessarily suspicious (legit no-flights)
    price = details.get('price')
    if price is None or price <= 0:
        return "price missing/non-positive"
    # Anything outside this is almost certainly a CAPTCHA-parse artifact.
    if price < 300 or price > 30000:
        return f"implausible price HK${int(price)} (range 300-30000)"
    # Parser must have populated flight-level fields. If both are missing,
    # the response was likely HTML garbage.
    if not details.get('outbound_flight') and not details.get('outbound_airline'):
        return "no flight number/airline in response"
    # Hermes 2026-07-10: per-route typical check. Long-haul routes have
    # typical HK$6,000-15,000; CAPTCHA-parse noise often lands in HK$500-2,000
    # range which passes the absolute range check above but is wildly out
    # of line with the route. Skip for short-haul routes where typical
    # is already < HK$3,000 (the absolute floor catches those).
    if route_typical is not None and route_typical >= 3000:
        floor = max(500, route_typical * 0.30)
        if price < floor:
            return (f"price HK${int(price)} < 30% of route typical "
                    f"HK${int(route_typical)} (floor HK${int(floor)})")
        # Hermes 2026-07-10: also catch HIGH outliers. CAPTCHA parse noise
        # sometimes picks up 7-8 digit numbers (HK$41M, HK$1.2B) instead of
        # the real price. Anything > 5× typical is almost certainly garbage.
        cap = route_typical * 5
        if price > cap:
            return (f"price HK${int(price)} > 5x route typical "
                    f"HK${int(route_typical)} (cap HK${int(cap)})")
    # Hermes 2026-07-09: duplicate-tuple detection. CAPTCHA pages tend to
    # return the same canned "result" for every query. We track the tuple
    # (airline, flight, price) per round and reject repeats.
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

def _is_long_haul_route(route: str) -> bool:
    """Hermes 2026-07-09: long-haul SZX routes need a higher price ceiling
    (NA/EU/Africa can legitimately be HK$8,000-15,000)."""
    long_haul_codes = {
        'AKL', 'AMS', 'BCN', 'CDG', 'CGK', 'CMB', 'CTS', 'CTU',
        'DEL', 'DOH', 'DPS', 'DXB', 'FCO', 'FRA', 'FUK', 'HAN',
        'HKT', 'ICN', 'JFK', 'JNB', 'KIX', 'KUL', 'LAX', 'LHR',
        'MAD', 'MEL', 'NGO', 'NRT', 'ORD', 'PEK', 'PEN', 'PUS',
        'PVG', 'RMQ', 'SEA', 'SFO', 'SIN', 'SYD', 'TPE', 'XIY', 'YVR',
    }
    dest = route.split('→', 1)[1] if '→' in route else ''
    return dest in long_haul_codes

def get_details(searcher, origin, dest, dep_date, ret_date):
    try:
        orig_apt = resolve_enum(Airport, origin)
        dest_apt = resolve_enum(Airport, dest)
    except Exception as e:
        log(f"  Airport resolve error: {e}")
        return None
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
            ]
        )
        # Hermes 2026-08-23: top_n=1 cuts request amplification.
        # See fli_detail_scan_aggressive.py for the rationale.
        results = searcher.search(filters, top_n=1)
        if not results:
            log(f"  Empty results for {dep_date}→{ret_date}")
            return None
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
            'total_duration': outbound.duration + ret.duration if (outbound and ret) else None
        }
    except Exception as e:
        log(f"  Error: {e}")
        return None

def main():
    log("=" * 50)
    log("SZX DETAIL SCAN STARTING")
    # Hermes 2026-07-09: PILOT_ROUTES filter (conservative proxy pilot)
    _apply_pilot()
    recorded_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = init_db()
    searcher = SearchFlights()
    total_saved = 0
    success = 0
    junk_for_round = 0  # Hermes 2026-07-09: CAPTCHA/garbage responses dropped before DB write
    seen_tuples: set = set()  # Hermes 2026-07-09: detect CAPTCHA repeats (same airline/flight/price across queries)

    for route in ROUTES:
        if route == 'SZX→SZX':
            continue
        origin, dest = route.split('→')
        log(f"Processing {route}...")
        dates = get_dates(conn, route, max_dates=9999)
        if not dates:
            log(f"  No dates found")
            continue
        log(f"  Found {len(dates)} dates at cheapest prices")
        # Hermes 2026-07-10: cache the per-route typical once per route.
        # Used by the CAPTCHA safeguard to catch "legit-looking but 90%
        # too cheap" rows. flight_dates is the clean baseline (no
        # CAPTCHA noise). Computed once to avoid hammering SQLite with
        # the same median query for every (dep_date, ret_date) combo.
        route_typical = _get_route_typical(route)
        if route_typical is not None:
            log(f"  route typical: HK${int(route_typical):,} (used by safeguard)")
        saved_for_route = 0
        for dep_date, ret_date, price in dates:
            # Hermes: smart re-scan policy. Google Flights prices revert constantly
            # (a $4,930 deal can be $5,520 the next day), but re-querying every
            # detail call would blow our 429 budget. Instead:
            #   1. Pre-check flight_dates (calendar price) against flight_details
            #      (last queried price).
            #   2. If they match within $5, skip the Google query — almost
            #      certainly unchanged.
            #   3. If they diverge, re-query Google to update flight_details AND
            #      mirror today's price into historical_prices so history.1d/4d/7d
            #      always reflects the latest scan, not a stale snapshot.
            c = conn.cursor()
            c.execute("SELECT price FROM flight_details WHERE route=? AND dep_date=? AND ret_date=?", (route, dep_date, ret_date))
            row = c.fetchone()
            existing_price = row[0] if row else None

            # Skip when the calendar price matches what we have — safe heuristic.
            if existing_price is not None and abs(existing_price - price) < 5.0:
                saved_for_route += 1
                continue

            details = get_details(searcher, origin, dest, dep_date, ret_date)
            # Hermes: get_details() catches all exceptions internally and
            # returns None. We can't distinguish 429 from other failures
            # here without re-architecting. The proxy pool's TTL/cooldown
            # (5 min / 60 s) provides natural back-pressure — no per-call
            # 429 reporting needed for v1.
            if details:
                # Hermes 2026-07-09: CAPTCHA/garbage guard. When Google returns
                # a challenge page through a proxy, the parser still extracts
                # numeric fields but they're nonsense (e.g. price=HK$3M from
                # matching a phone number on the challenge page). Drop these
                # BEFORE writing to the DB so we never poison flight_details.
                # Hermes 2026-07-10: also pass route_typical so the safeguard
                # can catch "looks legit but price is 90% too cheap" cases
                # (e.g. SZX→AMS HK$749 vs typical HK$7,802).
                suspicious = _is_suspicious_response(details, seen_tuples,
                                                     route_typical=route_typical)
                if suspicious:
                    # Track per-round junk for observability. We don't tell
                    # the proxy pool to mark_dead here — the parser can't
                    # distinguish CAPTCHA from real "no flights" cases.
                    log(f"  {dep_date}→{ret_date}: SUSPECT ({suspicious}) — dropped")
                    junk_for_round += 1
                    continue
                # Hermes: per-row write_transaction — see HKG detail scanner
                # for the full story. Identical pattern, different schema.
                try:
                    with fli_db.write_transaction(conn, label=f"szx detail {route} {dep_date}", flock_timeout_s=30) as tx:
                        tx.execute('''
                            INSERT OR REPLACE INTO flight_details
                            (route, dep_date, ret_date, price, outbound_airline, outbound_flight,
                             outbound_dep_time, outbound_arr_time, outbound_stops, outbound_aircraft,
                             return_airline, return_flight, return_dep_time, return_arr_time,
                             return_stops, return_aircraft, total_duration, scan_time, departure)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (
                            route, dep_date, ret_date, details['price'],
                            details['outbound_airline'], details['outbound_flight'],
                            details['outbound_dep_time'], details['outbound_arr_time'],
                            details['outbound_stops'], details['outbound_aircraft'],
                            details['return_airline'], details['return_flight'],
                            details['return_dep_time'], details['return_arr_time'],
                            details['return_stops'], details['return_aircraft'],
                            details['total_duration'], recorded_date, DEPARTURE
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
            time.sleep(2.5)  # Hermes: was 1.5s, raised to ease 429 pressure from Google Flights
            # Hermes 2026-07-10: periodic GC every 5 dates to stop the
            # curl_cffi session buffers from accumulating. Without this,
            # RSS climbs ~5MB/date through the slow proxies until OOM.
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

        # Hermes 2026-07-26: per-route incremental export — mirrors the
        # HKG detail scanner's pattern. Without this, the SZX deals page
        # stays in "pending" while the Telegram bot has already alerted
        # — same BKK race as HKG, but for SZX→XXX routes.
        if saved_for_route > 0:
            try:
                r = subprocess.run(
                    [sys.executable, '-u', '/data/export_all_dates_szx.py'],
                    check=False, timeout=60,
                )
                if r.returncode == 0:
                    log(f"  exported {route} → /data/all_dates_szx.json (incremental, detail-confirmed)")
                else:
                    log(f"  export FAILED exit={r.returncode} for {route} — JSON stale, will retry next round")
            except subprocess.TimeoutExpired:
                log(f"  export TIMEOUT for {route} — JSON stale, will retry next round")
            except Exception as e:
                log(f"  export EXCEPTION for {route}: {e}")

        if saved_for_route > 0:
            success += 1.

    log(f"SZX scan complete! Saved {total_saved} details from {success}/{len(ROUTES)} routes, dropped {junk_for_round} suspicious (CAPTCHA/garbage)")
    conn.close()
    return total_saved, success

if __name__ == '__main__':
    main()
