#!/usr/bin/env python3
"""SZX Detail Scanner - scan flight details for SZX→XXX routes."""
import sys, sqlite3, time
from datetime import datetime
sys.path.insert(0, '/install')
sys.path.insert(0, '/data')  # Hermes: fli_db.py lives next to the scanners
from fli.search import SearchFlights
from fli.models.google_flights.base import TripType, FlightSegment
from fli.models.google_flights.flights import FlightSearchFilters
from fli.core.parsers import resolve_enum
from fli.models import Airport

import fli_db  # Hermes: shared DB helper — see fli_db.py for the flock+busy story

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
        results = searcher.search(filters)
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
    recorded_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = init_db()
    searcher = SearchFlights()
    total_saved = 0
    success = 0

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
            if details:
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
        if saved_for_route > 0:
            success += 1.

    log(f"SZX scan complete! Saved {total_saved} details from {success}/{len(ROUTES)} routes")
    conn.close()
    return total_saved, success

if __name__ == '__main__':
    main()
