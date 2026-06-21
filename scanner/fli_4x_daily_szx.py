#!/usr/bin/env python3
"""SZX Calendar Scanner - scans SZX→XXX routes and saves to flight_dates with departure='SZX'."""
import sys, os, sqlite3, time
from datetime import datetime, timedelta
from statistics import median
sys.path.insert(0, '/install')
from fli.search import SearchDates
from fli.models.google_flights.dates import DateSearchFilters
from fli.models.google_flights.base import FlightSegment, TripType, PassengerInfo
from fli.core.parsers import resolve_enum
from fli.models import Airport

DB_PATH = '/data/fli_calendar.db'
LOG_FILE = '/tmp/fli_4x_szx.log'
DEPARTURE = 'SZX'
# Hermes: per-route delay (seconds). Read from env, default 2s for batch mode.
# Continuous mode (fli_4x_continuous.py) sets this to 60 to avoid Google rate limits.
ROUTE_DELAY = int(os.environ.get('ROUTE_DELAY_SECONDS', '2'))

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
    'SZX→SIN', 'SZX→SYD', 'SZX→TPE', 'SZX→XIY', 'SZX→YVR'
]

def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(line + '\n')
    except:
        pass

def init_db(conn):
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS flight_dates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route TEXT NOT NULL,
            dep_date TEXT NOT NULL,
            ret_date TEXT NOT NULL,
            price REAL NOT NULL,
            currency TEXT DEFAULT 'HKD',
            duration INTEGER,
            scan_time TEXT NOT NULL,
            departure TEXT DEFAULT 'HKG',
            UNIQUE(route, dep_date, ret_date, departure)
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_fd_route ON flight_dates(route)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_fd_dep ON flight_dates(dep_date)')
    # Mirror HKG: also record into historical_prices so 1d/4d/7d drop tracking works for SZX
    c.execute('''
        CREATE TABLE IF NOT EXISTS historical_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route TEXT NOT NULL,
            dep_date TEXT NOT NULL,
            ret_date TEXT,
            price REAL NOT NULL,
            currency TEXT DEFAULT 'HKD',
            recorded_date TEXT NOT NULL,
            departure TEXT DEFAULT 'HKG',
            UNIQUE(route, dep_date, ret_date, recorded_date, departure)
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_hist_route ON historical_prices(route)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_hist_recorded ON historical_prices(recorded_date)')
    conn.commit()

def scan_route(searcher, origin, dest):
    results = []
    today = datetime.now()
    try:
        orig_apt = resolve_enum(Airport, origin)
        dest_apt = resolve_enum(Airport, dest)
    except:
        return results

    best_prices = {}
    from_date = today + timedelta(days=1)
    to_date = from_date + timedelta(days=121)

    for _ in range(2):
        if from_date > today + timedelta(days=370):
            break
        try:
            for dur in [3, 7, 14]:
                try:
                    filters = DateSearchFilters(
                        trip_type=TripType.ROUND_TRIP,
                        passenger_info=PassengerInfo(),
                        flight_segments=[
                            FlightSegment(
                                departure_airport=[[orig_apt, 0]],
                                arrival_airport=[[dest_apt, 0]],
                                travel_date=from_date.strftime("%Y-%m-%d")
                            ),
                            FlightSegment(
                                departure_airport=[[dest_apt, 0]],
                                arrival_airport=[[orig_apt, 0]],
                                travel_date=(from_date + timedelta(days=dur)).strftime("%Y-%m-%d")
                            )
                        ],
                        from_date=from_date.strftime("%Y-%m-%d"),
                        to_date=to_date.strftime("%Y-%m-%d"),
                        duration=dur
                    )
                    prices = searcher.search(filters)
                    if prices:
                        for p in prices:
                            if isinstance(p.date, tuple) and len(p.date) >= 2:
                                dep = p.date[0].strftime("%Y-%m-%d")
                                ret = p.date[1].strftime("%Y-%m-%d")
                                key = (dep, ret)
                                if key not in best_prices or p.price < best_prices[key]:
                                    best_prices[key] = p.price
                except Exception as e:
                    pass
        except Exception as e:
            pass

        from_date = to_date + timedelta(days=1)
        to_date = from_date + timedelta(days=121)

    for (dep, ret), price in best_prices.items():
        results.append({'dep_date': dep, 'ret_date': ret, 'price': price})

    return results

def save_prices(conn, route, prices, recorded_date, departure='SZX'):
    c = conn.cursor()
    saved = 0
    for p in prices:
        try:
            # Mirror HKG: INSERT OR REPLACE into historical_prices (per departure)
            c.execute('''
                INSERT OR REPLACE INTO historical_prices (route, dep_date, ret_date, price, recorded_date, departure)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (route, p['dep_date'], p['ret_date'], p['price'], recorded_date, departure))
            # Also update flight_dates with current prices (INSERT OR IGNORE so existing detail rows aren't clobbered)
            c.execute('''
                INSERT OR IGNORE INTO flight_dates (route, dep_date, ret_date, price, duration, scan_time, departure)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (route, p['dep_date'], p['ret_date'], p['price'], 7, recorded_date, departure))
            saved += 1
        except:
            pass
    conn.commit()
    return saved

def run_scan():
    log("=" * 50)
    log("SZX CALENDAR SCAN STARTING")
    recorded_date = datetime.now().strftime("%Y-%m-%d")
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA busy_timeout = 30000")
    init_db(conn)
    searcher = SearchDates()
    total_saved = 0
    success = 0

    for route in ROUTES:
        origin, dest = route.split('→')
        log(f"Scanning {route}...")
        prices = scan_route(searcher, origin, dest)
        if prices:
            saved = save_prices(conn, route, prices, recorded_date, DEPARTURE)
            total_saved += saved
            success += 1
            log(f"  {len(prices)} dates, {saved} new")
        else:
            log(f"  no data")
        time.sleep(ROUTE_DELAY)

    log(f"SZX scan complete! Saved {total_saved} obs from {success}/{len(ROUTES)} routes")
    conn.close()
    return total_saved, success

if __name__ == '__main__':
    run_scan()
