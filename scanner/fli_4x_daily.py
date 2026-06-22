#!/usr/bin/env python3
"""
Fli 4x Daily Scanner + WordPress Update
Runs at 6am, 12pm, 6pm, midnight
"""
import sys, os, sqlite3
import urllib.request
import json
from datetime import datetime, timedelta
from statistics import median

sys.path.insert(0, '/install')
sys.path.insert(0, '/data')  # Hermes: fli_db.py lives next to the scanners

from fli.search import SearchDates
from fli.models.google_flights.dates import DateSearchFilters
from fli.models.google_flights.base import FlightSegment, TripType, PassengerInfo
from fli.core.parsers import resolve_enum
from fli.models import Airport

import fli_db  # Hermes: shared DB helper — see fli_db.py for the flock+busy story

DB_PATH = '/data/fli_calendar.db'  # legacy, used by export scripts only
LOG_FILE = '/tmp/fli_4x.log'

# Hermes: per-route delay (seconds). Read from env, default 2s for batch mode.
# Continuous mode (fli_4x_continuous.py) sets this to 60 to avoid Google rate limits.
ROUTE_DELAY = int(os.environ.get('ROUTE_DELAY_SECONDS', '2'))

# WordPress config
WP_USER = "Comparetiger"
WP_APP_PASSWORD = "ohWl WFCL g0rd RwJo kqle Ibep"
WP_PAGE = "5161"

CITY_NAMES = {
    "AKL": "奧克蘭", "AMS": "阿姆斯特丹", "BCN": "巴塞羅那", "BKK": "曼谷",
    "BOM": "孟買", "CAI": "開羅", "CAN": "廣州", "CDG": "巴黎",
    "CGK": "雅加達", "CMB": "科倫坡", "CTS": "札幌", "CTU": "成都",
    "DEL": "德里", "DOH": "多哈", "DPS": "巴厘島", "DXB": "迪拜",
    "FCO": "羅馬", "FRA": "法蘭克福", "FUK": "福岡", "HAN": "河內",
    "HKT": "布吉", "ICN": "首爾", "JFK": "紐約", "JNB": "約翰內斯堡",
    "KHH": "高雄", "KIX": "大阪", "KUL": "吉隆坡", "LAX": "洛杉矶",
    "LHR": "倫敦", "MAD": "馬德里", "MEL": "墨爾本", "MNL": "馬尼拉",
    "NGO": "名古屋", "NRT": "東京成田", "OKA": "沖繩", "ORD": "芝加哥",
    "PEK": "北京", "PEN": "檳城", "PUS": "釜山", "PVG": "上海浦東",
    "RGN": "仰光", "RMQ": "台中", "SEA": "西雅圖", "SFO": "三藩市",
    "SGN": "胡志明市", "SIN": "新加坡", "SYD": "悉尼", "SZX": "深圳",
    "TPE": "台北", "XIY": "西安", "YVR": "溫哥華"
}

ROUTES = [
    'HKG→AKL', 'HKG→AMS', 'HKG→BCN', 'HKG→BKK', 'HKG→BOM',
    'HKG→CAI', 'HKG→CAN', 'HKG→CDG', 'HKG→CGK', 'HKG→CMB',
    'HKG→CTS', 'HKG→CTU', 'HKG→DEL', 'HKG→DOH', 'HKG→DPS',
    'HKG→DXB', 'HKG→FCO', 'HKG→FRA', 'HKG→FUK', 'HKG→HAN',
    'HKG→HKT', 'HKG→ICN', 'HKG→JFK', 'HKG→JNB', 'HKG→KHH',
    'HKG→KIX', 'HKG→KUL', 'HKG→LAX', 'HKG→LHR', 'HKG→MAD',
    'HKG→MEL', 'HKG→MNL', 'HKG→NGO', 'HKG→NRT', 'HKG→OKA',
    'HKG→ORD', 'HKG→PEK', 'HKG→PEN', 'HKG→PUS', 'HKG→PVG',
    'HKG→RGN', 'HKG→RMQ', 'HKG→SEA', 'HKG→SFO', 'HKG→SGN',
    'HKG→SIN', 'HKG→SYD', 'HKG→SZX', 'HKG→TPE', 'HKG→XIY', 'HKG→YVR'
]

def log(msg):
    # Hermes: only write to file. Stdout is already captured by the supervisor
    # and would otherwise cause duplicate lines.
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(line + '\n')
    except Exception:
        pass

def init_db():
    # Hermes: route the schema setup through fli_db so WAL + busy_timeout are
    # applied idempotently alongside the schema. This replaces the raw
    # sqlite3.connect + ad-hoc PRAGMA from the old version.
    conn = fli_db.connect()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS historical_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route TEXT NOT NULL,
            dep_date TEXT NOT NULL,
            ret_date TEXT,
            price REAL NOT NULL,
            currency TEXT DEFAULT 'HKD',
            recorded_date TEXT NOT NULL,
            UNIQUE(route, dep_date, ret_date, recorded_date)
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_hist_route ON historical_prices(route)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_hist_recorded ON historical_prices(recorded_date)')
    conn.commit()
    return conn

def scan_route(searcher, origin, dest):
    results = []
    today = datetime.now()
    try:
        orig_apt = resolve_enum(Airport, origin)
        dest_apt = resolve_enum(Airport, dest)
    except:
        return results
    
    from_date = today + timedelta(days=1)
    to_date = from_date + timedelta(days=60)
    
    for _ in range(2):
        if from_date > today + timedelta(days=305):
            break
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
                        travel_date=(from_date + timedelta(days=7)).strftime("%Y-%m-%d")
                    )
                ],
                from_date=from_date.strftime("%Y-%m-%d"),
                to_date=to_date.strftime("%Y-%m-%d"),
                duration=7
            )
            prices = searcher.search(filters)
            if prices:
                for p in prices:
                    if isinstance(p.date, tuple) and len(p.date) >= 2:
                        dep = p.date[0].strftime("%Y-%m-%d")
                        ret = p.date[1].strftime("%Y-%m-%d")
                        results.append({'dep_date': dep, 'ret_date': ret, 'price': p.price})
        except:
            pass
        
        from_date = to_date + timedelta(days=1)
        to_date = from_date + timedelta(days=60)
    
    return results

def save_prices(conn, route, prices, recorded_date):
    """Save prices with the bulletproof write_transaction.

    Combines: cross-process flock (excludes other writers) +
    BEGIN IMMEDIATE (fails fast on lock contention) + auto-commit +
    rollback-on-exception. The whole batch is atomic.

    If we get a transient SQLITE_BUSY, write_transaction retries with
    backoff. If we get a real error (Google rate limit, bad data, etc.)
    the exception is logged and we return what was saved so far.
    """
    saved = 0
    try:
        with fli_db.write_transaction(conn, label=f"save {route}", flock_timeout_s=60) as tx:
            for p in prices:
                # Update historical_prices with INSERT OR REPLACE (was INSERT OR IGNORE)
                tx.execute('''
                    INSERT OR REPLACE INTO historical_prices (route, dep_date, ret_date, price, recorded_date)
                    VALUES (?, ?, ?, ?, ?)
                ''', (route, p['dep_date'], p['ret_date'], p['price'], recorded_date))

                # Also update flight_dates with current prices using INSERT OR REPLACE
                tx.execute('''
                    INSERT OR REPLACE INTO flight_dates (route, dep_date, ret_date, price, currency, duration, scan_time)
                    VALUES (?, ?, ?, ?, ?, ?, datetime())
                ''', (route, p['dep_date'], p['ret_date'], p['price'], p.get('currency', 'HKD'), p.get('duration', 7)))

                saved += 1
    except TimeoutError as e:
        log(f"Save lock timeout for {route} (other writer held lock >60s): {e}")
    except sqlite3.OperationalError as e:
        if "locked" in str(e).lower():
            # write_transaction retried 5x and still failed — shouldn't happen
            # unless a foreign connection is holding a long write transaction.
            log(f"Save persistent lock failure for {route}: {e}")
        else:
            log(f"Save error for {route}: {e}")
    except Exception as e:
        log(f"Save unexpected error for {route}: {e}")
    return saved

def run_scan():
    log("=" * 50)
    log("FLI SCAN STARTING")
    
    recorded_date = datetime.now().strftime("%Y-%m-%d")
    conn = init_db()
    
    searcher = SearchDates()
    total_saved = 0
    success = 0
    
    for route in ROUTES:
        origin, dest = route.split('→')
        log(f"Scanning {route}...")
        
        prices = scan_route(searcher, origin, dest)
        if prices:
            saved = save_prices(conn, route, prices, recorded_date)
            total_saved += saved
            success += 1
            log(f"  {len(prices)} dates, {saved} new")
        else:
            log(f"  no data")
        
        import time
        time.sleep(ROUTE_DELAY)
    
    log(f"Scan complete! Saved {total_saved} obs from {success}/{len(ROUTES)} routes")
    conn.close()
    return total_saved, success

def post_to_wp(html):
    url = f"https://comparetiger.com/?rest_route=/wp/v2/pages/{WP_PAGE}"
    import base64
    credentials = f"{WP_USER}:{WP_APP_PASSWORD}".encode()
    auth = base64.b64encode(credentials).decode()
    
    data = json.dumps({"content": html}).encode()
    req = urllib.request.Request(url, data=data, headers={
        'Authorization': f'Basic {auth}',
        'Content-Type': 'application/json'
    })
    
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status == 200
    except Exception as e:
        log(f"WP error: {e}")
        return False

def generate_report():
    # Hermes: read-only, but use fli_db.connect for consistent WAL/busy
    # settings so we never block the writers for more than a microsecond.
    conn = fli_db.connect()
    c = conn.cursor()
    
    c.execute('SELECT route, dep_date, MIN(price) as min_price FROM flight_dates GROUP BY route, dep_date ORDER BY route')
    rows = c.fetchall()
    
    route_daily_min = {}
    for row in rows:
        route = row[0]
        if route not in route_daily_min:
            route_daily_min[route] = []
        route_daily_min[route].append(row[2])
    
    route_typical = {r: median(p) for r, p in route_daily_min.items()}
    
    c.execute('SELECT route, dep_date, MIN(price) FROM flight_dates GROUP BY route ORDER BY route')
    current = {r[0]: r for r in c.fetchall()}
    
    results = []
    for route in sorted(route_typical.keys()):
        if route == 'HKG→HKG':
            continue
        typical = route_typical.get(route, 0)
        data = current.get(route)
        if data and typical > 0:
            cheapest = data[2]
            savings = (1 - cheapest / typical) * 100
            dest = route.replace('HKG→', '')
            city = CITY_NAMES.get(dest, dest)
            results.append((dest, city, typical, cheapest, savings))
    
    results.sort(key=lambda x: x[4], reverse=True)
    
    today = datetime.now().strftime("%Y-%m-%d %H:%M")
    
    html = f"""<div style="font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto;">
<h2 style="color: #1a88ff;">✈️ HKG 全部航空</h2>
<p style="color: #666;">📊 {len(results)}條路線 · {today}</p>

<h3 style="color: #ff4444;">🔥 Top 3 Deals:</h3>
<div style="background: #fff3f3; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
"""
    
    for r in results[:3]:
        html += f'<p style="margin: 5px 0;"><b>{r[1]} ({r[0]})</b>: HK${r[3]:,.0f} <span style="color: #ff4444;">({r[4]:.1f}%)</span> 🔥</p>'
    
    html += """</div>
<h3>📊 全部HKG路線價格</h3>
<table style="width: 100%; border-collapse: collapse; font-size: 14px;">
<tr style="background: #1a88ff; color: white;">
<th style="padding: 10px; text-align: left;">路線</th>
<th style="padding: 10px; text-align: left;">城市</th>
<th style="padding: 10px; text-align: right;">最低價</th>
<th style="padding: 10px; text-align: right;">一般價</th>
<th style="padding: 10px; text-align: right;">平幾多</th>
</tr>
"""
    
    for i, r in enumerate(results):
        bg = "#ffebee" if r[4] >= 15 else ("#f5f5f5" if i % 2 == 0 else "white")
        flag = '🔥' if r[4] >= 15 else ''
        html += f'<tr style="background: {bg};">'
        html += f'<td style="padding: 8px;"><b>HKG→{r[0]}</b></td>'
        html += f'<td style="padding: 8px;">{r[1]}</td>'
        html += f'<td style="padding: 8px; text-align: right; color: #1a88ff;"><b>HK${r[3]:,.0f}</b></td>'
        html += f'<td style="padding: 8px; text-align: right;">HK${r[2]:,.0f}</td>'
        html += f'<td style="padding: 8px; text-align: right; color: {"#ff4444" if r[4] >= 15 else "#666"};">{r[4]:.1f}% {flag}</td>'
        html += '</tr>'
    
    html += """</table>
<p style="color: #999; font-size: 12px; margin-top: 20px;">
* Typical price = median of daily minimums from scan data<br>
* 資料每6小時更新
</p>
</div>"""
    
    conn.close()
    return html

def main():
    log("=" * 60)
    log("FLI 4x DAILY SCANNER + WP UPDATE")
    log("=" * 60)
    
    # Run scan
    total, success = run_scan()
    
    # Generate and post report
    log("Generating WordPress report...")
    html = generate_report()
    
    if post_to_wp(html):
        log("WordPress updated successfully!")
    else:
        log("WordPress update FAILED!")
    
    log("Done!")

if __name__ == '__main__':
    main()
