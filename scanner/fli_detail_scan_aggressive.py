#!/usr/bin/env python3
"""Fixed FLI Detail Scanner - better error handling"""
import sys
import sqlite3
import time
from datetime import datetime

sys.path.insert(0, '/install')

from fli.search import SearchFlights
from fli.models.google_flights.base import TripType, FlightSegment
from fli.models.google_flights.flights import FlightSearchFilters
from fli.core.parsers import resolve_enum
from fli.models import Airport

DB_PATH = '/data/fli_calendar.db'

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
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA busy_timeout = 30000")
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
        
        results = searcher.search(filters)
        
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
    
    for route in ROUTES:
        origin, dest = route.split('→')
        log(f"Processing {route}...")
        
        dates_to_scan = get_dates_at_cheapest_prices(conn, route, max_dates=9999)
        
        if not dates_to_scan:
            log(f"  No dates found")
            continue
        
        log(f"  Found {len(dates_to_scan)} dates at cheapest prices")
        
        saved_for_route = 0
        for dep_date, ret_date, price in dates_to_scan:
            # Check if we already have details
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM flight_details WHERE route=? AND dep_date=? AND ret_date=?", 
                     (route, dep_date, ret_date))
            if c.fetchone()[0] > 0:
                saved_for_route += 1
                continue
            
            details = get_flight_details(searcher, origin, dest, dep_date, ret_date)
            
            if details:
                try:
                    c.execute('''
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
                    conn.commit()
                    total_saved += 1
                    saved_for_route += 1
                    log(f"  {dep_date}→{ret_date}: {details['outbound_airline']} {details['outbound_flight']} @ HK${details['price']}")
                except Exception as e:
                    log(f"  DB error: {e}")
            else:
                log(f"  {dep_date}→{ret_date}: No details")
            
            time.sleep(1.5)
        
        if saved_for_route > 0:
            success += 1
    
    log(f"Scan complete! Saved {total_saved} details from {success}/{len(ROUTES)} routes")
    conn.close()
    return total_saved, success

if __name__ == '__main__':
    main()
