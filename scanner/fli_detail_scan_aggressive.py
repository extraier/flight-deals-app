#!/usr/bin/env python3
"""Fixed FLI Detail Scanner - better error handling"""
import sys
import sqlite3
import subprocess
import time
from datetime import datetime

sys.path.insert(0, '/install')
sys.path.insert(0, '/data')  # Hermes: fli_db.py lives next to the scanners

# Hermes 2026-08-23: safety primitives from Detail-Flight Scan Enforcement
# Incident Review.md — bounded quota, fleet circuit breaker, typed errors.
from detail_scan_safety import (
    CircuitOpen,
    DailyRouteQuota,
    ProviderBlocked,
    ProviderDenied,
    ProviderSchemaChanged,
    QuotaExceeded,
    raise_if_circuit_open,
)

# Hermes 2026-07-10: cap fli.search's internal ThreadPoolExecutor at 2
# workers. Same OOM-fix as SZX/UO pilots — see fli_detail_scan_szx.py
# for full rationale. With 3 concurrent scanners (4x daily, 4x
# continuous, aggressive) we hit the 256MB container cgroup limit
# without this. 2 workers keeps each process around 60-70MB.
try:
    from fli.search._concurrency import configure_concurrency
    configure_concurrency(2)
except Exception:
    pass

from fli.search import SearchFlights
from fli.models.google_flights.base import TripType, FlightSegment
from fli.models.google_flights.flights import FlightSearchFilters
from fli.core.parsers import resolve_enum
from fli.models import Airport

import fli_db  # Hermes: shared DB helper — see fli_db.py for the flock+busy story

DB_PATH = '/data/fli_calendar.db'  # legacy, used by export scripts only

ROUTES = [
    'HKG→AKL', 'HKG→AMS', 'HKG→BCN', 'HKG→BKK', 'HKG→BOM',
    'HKG→CAI', 'HKG→CAN', 'HKG→CDG', 'HKG→CGK', 'HKG→CMB',
    'HKG→CTS', 'HKG→CTU', 'HKG→DEL', 'HKG→DOH', 'HKG→DPS',
    'HKG→DXB', 'HKG→FCO', 'HKG→FRA', 'HKG→FUK', 'HKG→HAN',
    'HKG→HKT', 'HKG→ICN', 'HKG→JFK', 'HKG→JNB', 'HKG→KHH',
    'HKG→KIX', 'HKG→KUL', 'HKG→LAX', 'HKG→LHR', 'HKG→MAD',
    'HKG→MEL', 'HKG→MNL', 'HKG→NGO', 'HKG→NRT', 'HKG→OKE',
    'HKG→ORD', 'HKG→PEK', 'HKG→PEN', 'HKG→PUS', 'HKG→PVG',
    'HKG→RGN', 'HKG→RMQ', 'HKG→SEA', 'HKG→SFO', 'HKG→SGN',
    'HKG→SIN', 'HKG→SYD', 'HKG→SZX', 'HKG→TPE', 'HKG→XIY',
    'HKG→YVR'
]

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
            UNIQUE(route, dep_date, ret_date)
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_details_route ON flight_details(route)')
    conn.commit()
    return conn

def get_dates_at_cheapest_prices(conn, route, max_dates=9999):
    c = conn.cursor()
    c.execute('''
        SELECT MIN(price) FROM flight_dates
        WHERE route = ? AND dep_date >= date('now')
    ''', (route,))
    min_price = c.fetchone()[0]
    
    if not min_price:
        return []
    
    threshold = min_price * 1.15
    c.execute('''
        SELECT dep_date, ret_date, MIN(price) as price
        FROM flight_dates
        WHERE route = ? AND dep_date >= date('now') AND price <= ?
        GROUP BY dep_date, ret_date
        ORDER BY price ASC, dep_date ASC
        LIMIT ?
    ''', (route, threshold, max_dates))
    
    return c.fetchall()

def get_flight_details(searcher, origin, dest, dep_date, ret_date):
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
        
        # Hermes 2026-08-23: top_n=1 cuts request amplification. fli's
        # default top_n=5 triggers 5 outbound expansions per round-trip
        # search — but the scanner only consumes results[0], so the
        # other 4 expansions are pure wasted quota. See
        # Detail-Flight Scan Enforcement Incident Review.md (2026-08-23)
        # for the request-budget math.
        results = searcher.search(filters, top_n=1)
        
        if not results or len(results) == 0:
            log(f"  Warning: Empty results for {dep_date}→{ret_date}")
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
        log(f"  Error in get_flight_details: {e}")
        import traceback
        log(f"  Trace: {traceback.format_exc()[-500:]}")
        return None

def main():
    log("=" * 50)
    log("FLI DETAIL SCAN v3 STARTING")
    
    recorded_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = init_db()
    
    searcher = SearchFlights()
    total_saved = 0
    success = 0

    # Hermes 2026-08-23: per-route daily request counter. Loaded once
    # for the whole run so concurrent reads see consistent counts.
    daily_quota = DailyRouteQuota()

    # Hermes 2026-07-10: per-route typical price cache for the CAPTCHA
    # safeguard below. Loaded lazily — most routes need it, and computing
    # all 51 medians upfront takes ~1s for ~30k rows.
    route_typical_map = {}

    def _load_route_typical(r):
        """Median price from flight_dates for the past 60 days. Same
        baseline as fli_detail_scan_szx._get_route_typical — kept as a
        local helper so we don't have to refactor the import surface."""
        try:
            ac = sqlite3.connect(DB_PATH, timeout=10)
            cur = ac.cursor()
            cur.execute("""
                SELECT price FROM flight_dates
                WHERE route = ?
                  AND dep_date >= date('now', '-60 days')
            """, (r,))
            prices = [row[0] for row in cur.fetchall() if row[0] and row[0] > 0]
            ac.close()
            if len(prices) < 10:
                return None
            prices.sort()
            return prices[len(prices) // 2]
        except Exception as e:
            log(f"  _load_route_typical({r}) failed: {e}")
            return None

    for route in ROUTES:
        origin, dest = route.split('→')
        log(f"Processing {route}...")

        # Hermes 2026-08-23: fleet circuit breaker check at the top of
        # each route. If a single ban signal has been observed on any
        # egress, the entire fleet must stop — no per-IP retry, no
        # proxy rotation, just halt.
        try:
            raise_if_circuit_open()
        except Exception as e:
            log(f"  CIRCUIT OPEN: {e} — halting fleet")
            break

        # Hermes 2026-08-23: per-route daily cap. Bounded so a
        # temporary broad price movement can't turn one round into
        # thousands of detail queries.
        if daily_quota.is_exhausted(route):
            log(f"  daily quota exhausted for {route} "
                f"({daily_quota.used(route)}/{daily_quota.cap}), skipping")
            continue

        # Hermes 2026-07-10: lazy-load the per-route typical once for
        # the CAPTCHA safeguard below. Caches for the whole round so
        # we don't query SQLite on every (dep_date, ret_date) iteration.
        if route not in route_typical_map:
            route_typical_map[route] = _load_route_typical(route)
        route_typical = route_typical_map[route]
        if route_typical is not None:
            log(f"  route typical: HK${int(route_typical):,} (used by safeguard)")

        # Hermes 2026-08-23: max_dates dropped 9999 -> daily_quota.cap.
        # The "within 15% of route minimum" filter still bounds the
        # candidate population, but the absolute count is now capped.
        dates_to_scan = get_dates_at_cheapest_prices(
            conn, route, max_dates=daily_quota.remaining(route),
        )
        
        if not dates_to_scan:
            log(f"  No dates found")
            continue
        
        log(f"  Found {len(dates_to_scan)} dates at cheapest prices")
        
        saved_for_route = 0
        for dep_date, ret_date, price in dates_to_scan:
            # Hermes: smart re-scan policy. Google Flights prices revert constantly
            # (a $4,930 deal can be $5,520 the next day), but re-querying every
            # detail call would blow our 429 budget. Instead:
            #   1. Always run the cheap pre-check from flight_dates (current
            #      calendar price) against flight_details (last queried price).
            #   2. If they match within $5, skip the Google query — almost
            #      certainly unchanged.
            #   3. If they diverge, re-query Google to update flight_details AND
            #      mirror today's price into historical_prices so history.1d/4d/7d
            #      always reflects the latest scan, not a stale snapshot.
            c = conn.cursor()

            # Hermes 2026-08-23: re-check quota each iteration. Once we
            # hit the daily cap, stop the route and move on.
            if daily_quota.is_exhausted(route):
                log(f"  daily quota hit for {route}, ending route scan")
                break
            c.execute("SELECT price FROM flight_details WHERE route=? AND dep_date=? AND ret_date=?",
                     (route, dep_date, ret_date))
            row = c.fetchone()
            existing_price = row[0] if row else None

            # Skip when the calendar price matches what we have — safe heuristic.
            if existing_price is not None and abs(existing_price - price) < 5.0:
                saved_for_route += 1
                continue

            # Hermes 2026-08-23: circuit breaker check before every request.
            # A single ban signal on any egress must stop this loop too.
            try:
                raise_if_circuit_open()
            except CircuitOpen as e:
                log(f"  CIRCUIT OPEN: {e} — halting fleet mid-route")
                raise SystemExit(0)  # Clean exit, not a crash.

            details = get_flight_details(searcher, origin, dest, dep_date, ret_date)

            # Record the attempt — whether or not the result was usable.
            # The quota bounds total HTTP requests, not just successful ones.
            daily_quota.record(route)

            if details:
                # Hermes 2026-07-10: CAPTCHA/garbage guard. Mirrors the
                # SZX/UO detail scanners' safeguard. Without this, the
                # aggressive scanner was writing HK$1.2B and HK$146M
                # rows from CAPTCHA parse noise.
                if details.get('price') is not None:
                    p = details['price']
                    # Absolute range (covers short + long-haul with safety margin).
                    if p < 300 or p > 30000:
                        log(f"  {dep_date}: SUSPECT (implausible price HK${int(p)}) — dropped")
                        continue
                    # Per-route typical (loaded once at route start below).
                    rt = route_typical_map.get(route)
                    if rt is not None and rt >= 3000:
                        floor = max(500, rt * 0.30)
                        cap = rt * 5
                        if p < floor or p > cap:
                            log(f"  {dep_date}: SUSPECT (price HK${int(p)} outside [HK${int(floor)}, HK${int(cap)}] for route typical HK${int(rt)}) — dropped")
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

            time.sleep(2.5)  # Hermes: was 1.5s, raised to ease 429 pressure from Google Flights

        # Hermes 2026-07-26: per-route incremental export — mirrors the
        # calendar scanner's pattern (see fli_4x_daily.py ~line 217). When
        # the detail scanner confirms a drop (writes today's price into
        # historical_prices), the export needs to re-run so the deals page
        # sees the dropAmount/dropPct/firstDetected stamp within seconds
        # instead of waiting for the next calendar route scan (up to 50
        # min gap). Without this, the page stays in "pending" state while
        # the Telegram bot has already alerted — exactly the BKK race the
        # user reported.
        #
        # Only re-export when this route actually wrote new rows — saves
        # ~2.6s of export overhead on no-op routes. 50 routes × 2.6s when
        # all hit = 130s/round, negligible vs the 50-min round duration.
        if saved_for_route > 0:
            try:
                r = subprocess.run(
                    [sys.executable, '-u', '/data/export_all_dates_hkg_v2.py'],
                    check=False, timeout=60,
                )
                if r.returncode == 0:
                    log(f"  exported {route} → /data/all_dates.json (incremental, detail-confirmed)")
                else:
                    log(f"  export FAILED exit={r.returncode} for {route} — JSON stale, will retry next round")
            except subprocess.TimeoutExpired:
                log(f"  export TIMEOUT for {route} — JSON stale, will retry next round")
            except Exception as e:
                log(f"  export EXCEPTION for {route}: {e}")

        if saved_for_route > 0:
            success += 1
    
    log(f"Scan complete! Saved {total_saved} details from {success}/{len(ROUTES)} routes")
    conn.close()
    return total_saved, success

if __name__ == '__main__':
    main()
