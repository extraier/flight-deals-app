#!/usr/bin/env python3
"""Export SZX all_dates.json from fli_calendar.db (SZX departure only).

Now includes history["1d"] (yesterday's lowest price for the same dep_date) so
the frontend can compute "biggest drops" — mirrors HKG's export_all_dates_hkg_v2.py.
"""
import sqlite3, json, os
from statistics import median
from datetime import datetime, timedelta

DB_PATH = '/data/fli_calendar.db'
NAS_OUT = '/data/all_dates_szx.json'
DEPARTURE = 'SZX'

# Hermes: staleness threshold for flight_details rows. Mirrors HKG export —
# see export_all_dates_hkg_v2.py for the full rationale. Detail scanner hits
# a (route, dep_date) slowly; if it's been more than this many hours since
# its last detail scan, the export falls through to the fresh flight_dates
# price for that combo.
DETAIL_MAX_AGE_HOURS = int(os.environ.get('DETAIL_MAX_AGE_HOURS', '24'))

CITY_NAMES = {
    "AKL": "奧克蘭", "AMS": "阿姆斯特丹", "BCN": "巴塞羅那", "BKK": "曼谷",
    "BOM": "孟買", "CAI": "開羅", "CAN": "廣州", "CDG": "巴黎",
    "CGK": "雅加達", "CMB": "科倫坡", "CTS": "札幌", "CTU": "成都",
    "DEL": "德里", "DOH": "卡塔爾", "DPS": "巴厘島", "DXB": "迪拜",
    "FCO": "羅馬", "FRA": "法蘭克福", "FUK": "福岡", "HAN": "河內",
    "HKT": "布吉", "ICN": "首爾", "JFK": "紐約", "JNB": "約翰內斯堡",
    "KHH": "高雄", "KIX": "大阪", "KUL": "吉隆坡", "LAX": "洛杉矶",
    "LHR": "倫敦", "MAD": "馬德里", "MEL": "墨爾本", "MNL": "馬尼拉",
    "NGO": "名古屋", "NRT": "東京成田", "OKE": "沖繩", "ORD": "芝加哥",
    "PEK": "北京", "PEN": "檳城", "PUS": "釜山", "PVG": "上海浦東",
    "RGN": "仰光", "RMQ": "台中", "SEA": "西雅圖", "SFO": "三藩市",
    "SGN": "胡志明市", "SIN": "新加坡", "SYD": "悉尼", "SZX": "深圳",
    "TPE": "台北", "XIY": "西安", "YVR": "溫哥華"
}

REGION_MAP = {
    "AKL": "大洋洲", "AMS": "歐洲", "BCN": "歐洲", "BKK": "東南亞",
    "BOM": "南亞", "CAI": "中東", "CAN": "中國", "CDG": "歐洲",
    "CGK": "東南亞", "CMB": "南亞", "CTS": "東亞", "CTU": "中國",
    "DEL": "南亞", "DOH": "中東", "DPS": "東南亞", "DXB": "中東",
    "FCO": "歐洲", "FRA": "歐洲", "FUK": "東亞", "HAN": "東南亞",
    "HKT": "東南亞", "ICN": "東亞", "JFK": "北美洲", "JNB": "非洲",
    "KHH": "東亞", "KIX": "東亞", "KUL": "東南亞", "LAX": "北美洲",
    "LHR": "歐洲", "MAD": "歐洲", "MEL": "大洋洲", "MNL": "東南亞",
    "NGO": "東亞", "NRT": "東亞", "OKE": "東亞", "ORD": "北美洲",
    "PEK": "中國", "PEN": "東南亞", "PUS": "東亞", "PVG": "中國",
    "RGN": "東南亞", "RMQ": "東亞", "SEA": "北美洲", "SFO": "北美洲",
    "SGN": "東南亞", "SIN": "東南亞", "SYD": "大洋洲", "SZX": "中國",
    "TPE": "東亞", "XIY": "中國", "YVR": "北美洲"
}

conn = sqlite3.connect(DB_PATH, timeout=30)
conn.execute("PRAGMA busy_timeout = 30000")
c = conn.cursor()

# ── Historical price map (SZX only) ───────────────────────────────────────
# Read yesterday's recorded prices from historical_prices table. Mirror of
# export_all_dates_hkg_v2.py: for each route+dep_date, look up the price from
# 1d/4d/7d ago so the frontend can render "biggest drop" comparisons.
hist = {}  # hist[route][dep_date][label] = price
for days in [1, 4, 7]:
    label = f"{days}d"
    target_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
    c.execute("""
        SELECT route, dep_date, price
        FROM historical_prices
        WHERE departure=? AND recorded_date=?
    """, (DEPARTURE, target_date))
    for route, dep_date, price in c.fetchall():
        if route not in hist:
            hist[route] = {}
        if dep_date not in hist[route]:
            hist[route][dep_date] = {}
        hist[route][dep_date][label] = price

# Load flight_details (SZX only)
# Hermes: filter out stale rows older than DETAIL_MAX_AGE_HOURS so a detail
# scanner that hasn't revisited a (route, dep_date) in days doesn't pin a
# stale price in front of the fresh flight_dates price. See HKG export for
# the full story.
details = {}
c.execute(f"""
    SELECT route, dep_date, ret_date, price, outbound_airline, outbound_flight,
           outbound_dep_time, outbound_arr_time, return_airline, return_flight,
           return_dep_time, return_arr_time, scan_time
    FROM flight_details WHERE departure='{DEPARTURE}'
      AND scan_time >= datetime('now', ?)
""", (f'-{DETAIL_MAX_AGE_HOURS} hours',))
for row in c.fetchall():
    route, dep_date, ret_date = row[0], row[1], row[2]
    details[(route, dep_date, ret_date)] = {
        "price": row[3], "airline": row[4], "flight_no": row[5],
        "dep_time": row[6], "arr_time": row[7],
        "return_airline": row[8], "return_flight": row[9],
        "return_dep_time": row[10], "return_arr_time": row[11], "ret_date": ret_date
    }
print(f"Loaded {len(details)} SZX flight_details records (max age {DETAIL_MAX_AGE_HOURS}h)")

# Load flight_dates (SZX only)
today = datetime.now().strftime('%Y-%m-%d')
c.execute(f"SELECT route, dep_date, ret_date, price FROM flight_dates WHERE departure='{DEPARTURE}' AND dep_date >= '{today}' ORDER BY route, price")
all_dates = {}
for route, dep_date, ret_date, price in c.fetchall():
    if route == 'SZX→SZX': continue
    if route not in all_dates: all_dates[route] = []
    dep_dt = datetime.strptime(dep_date, "%Y-%m-%d")
    ret_dt = datetime.strptime(ret_date, "%Y-%m-%d")
    stay = (ret_dt - dep_dt).days
    all_dates[route].append({"dep_date": dep_date, "ret_date": ret_date, "price": price, "stay": stay})
print(f"Loaded {sum(len(v) for v in all_dates.values())} SZX flight_dates records")

# Typical price
route_typical = {}
for route in all_dates:
    fd_prices = [details[k]["price"] for k in details if k[0] == route]
    if fd_prices:
        route_typical[route] = median(fd_prices)
    else:
        fd2_prices = [d["price"] for d in all_dates[route]]
        if fd2_prices:
            route_typical[route] = median(fd2_prices)

# Build results
results = []
for route_str in sorted(all_dates.keys()):
    dest_code = route_str.replace('SZX→', '')
    city_name = CITY_NAMES.get(dest_code, dest_code)
    region = REGION_MAP.get(dest_code, "其他")
    dates_pool = []

    for key, info in details.items():
        if key[0] != route_str: continue
        _, dep_date, ret_date = key
        dep_parts = dep_date.split("-")
        year, month, day = int(dep_parts[0]), int(dep_parts[1]), int(dep_parts[2])
        dep_dt = datetime.strptime(dep_date, "%Y-%m-%d")
        ret_dt = datetime.strptime(ret_date, "%Y-%m-%d")
        stay = (ret_dt - dep_dt).days
        dates_pool.append({
            "year": year, "month": month, "day": day,
            "dep_date": dep_date, "ret_date": ret_date,
            "price": info["price"], "stay": stay,
            "has_details": True,
            "flight": {
                "airline": info["airline"], "flight_no": info["flight_no"],
                "dep_time": info["dep_time"], "arr_time": info["arr_time"],
                "return_airline": info["return_airline"], "return_flight": info["return_flight"],
                "return_dep_time": info["return_dep_time"], "return_arr_time": info["return_arr_time"],
                "ret_date": info["ret_date"]
            }
        })

    fd_keys = set((k[0], k[1], k[2]) for k in details)
    for d in all_dates[route_str]:
        key = (route_str, d["dep_date"], d["ret_date"])
        if key not in fd_keys:
            dep_parts = d["dep_date"].split("-")
            year, month, day = int(dep_parts[0]), int(dep_parts[1]), int(dep_parts[2])
            dates_pool.append({
                "year": year, "month": month, "day": day,
                "dep_date": d["dep_date"], "ret_date": d["ret_date"],
                "price": d["price"], "stay": d["stay"],
                "has_details": False, "flight": None
            })

    dates_pool.sort(key=lambda x: (0 if x["has_details"] else 1, x["price"]))
    cheapest_dates = []
    for d in dates_pool[:10]:
        obj = {"day": d["day"], "month": d["month"], "year": d["year"],
               "price": int(d["price"]), "stay": d["stay"]}
        # Mirror HKG: attach history["1d"/"4d"/"7d"] with diff/pct so the
        # frontend can compute "yesterday's lowest price" comparisons.
        h_raw = hist.get(route_str, {}).get(d["dep_date"], {})
        if h_raw:
            changes = {}
            for label in ['1d', '4d', '7d']:
                if label in h_raw:
                    old_price = h_raw[label]
                    diff = int(d["price"]) - int(old_price)
                    pct = round(diff / old_price * 100, 1) if old_price else 0
                    changes[label] = {'price': int(old_price), 'diff': diff, 'pct': pct}
            if changes:
                obj["history"] = changes
        if d["flight"]:
            obj["flight"] = d["flight"]
        cheapest_dates.append(obj)

    cheapest_price = cheapest_dates[0]["price"] if cheapest_dates else 0
    typical = int(route_typical.get(route_str, 0))
    results.append({
        "route": route_str,
        "destination": {"name": city_name, "code": dest_code, "region": region},
        "price": cheapest_price, "currency": "HKD",
        "badge": {"carryOn": False, "cheapDays": len(dates_pool)},
        "typicalPrice": typical,
        "cheapestDates": cheapest_dates,
        "totalDestinations": len(all_dates)
    })

results.sort(key=lambda x: x["price"])

# ── Compute destination-level drops and stamp firstDetected ──────────────
# Persist a {route_key: iso_timestamp} map in /data/drop_first_detected.json
# so the deals page can show "first detected N hours ago" and sort by recency.
# Only routes currently showing a real drop (today_low < yesterday's min
# destination low by >=1%) are stamped.
#
# Reset rule (2026-06-23 fix): when a route stops being in a real-drop state
# the stamp is CLEARED immediately, instead of persisting for 14 days. This
# prevents stale "2 days ago" alerts from showing on the deals page after the
# price rebounds or a new cheaper date enters the top-30. The deals page
# client code also consumes `dropAmount` / `dropPct` (now stamped onto every
# route) so the single-date comparison bug in page.tsx no longer matters.
FIRST_DETECTED_PATH = '/data/drop_first_detected.json'
FIRST_DETECTED_MAX_AGE_DAYS = 14
now_iso = datetime.now().isoformat()
try:
    with open(FIRST_DETECTED_PATH) as _f:
        first_detected_map = json.load(_f)
        if not isinstance(first_detected_map, dict):
            first_detected_map = {}
except (FileNotFoundError, json.JSONDecodeError):
    first_detected_map = {}

stamped = 0
cleared = 0
for o in results:
    dates = o.get('cheapestDates') or []
    if not dates:
        o['firstDetected'] = None
        o['dropAmount'] = 0
        o['dropPct'] = 0
        o['dropPrice'] = 0
        continue
    # Today's destination lowest
    today_low = min((cd.get('price') or 0) for cd in dates) or 0
    # Yesterday's destination lowest
    yest_prices = [
        (cd.get('history') or {}).get('1d', {}).get('price')
        for cd in dates
    ]
    yest_prices = [p for p in yest_prices if p and p > 0]
    yest_low = min(yest_prices) if yest_prices else None
    drop_pct = ((today_low - yest_low) / yest_low * 100) if (yest_low and yest_low > 0 and today_low > 0) else 0

    key = f"SZX→{o.get('destination', {}).get('code', '')}"
    if drop_pct <= -1.0:
        # Active drop — stamp if missing
        if key not in first_detected_map:
            first_detected_map[key] = now_iso
            stamped += 1
        o['firstDetected'] = first_detected_map[key]
    else:
        # No active drop — clear the stamp so the deals page stops showing
        # this route as an active alert. (Pre-2026-06-23 bug: the stamp was
        # kept for 14d, producing "2 days ago" ghost alerts on PUS and other
        # routes that had already rebounded.)
        if key in first_detected_map:
            del first_detected_map[key]
            cleared += 1
        o['firstDetected'] = None

    # Always stamp destination-level drop numbers on the route so the
    # client can display them without re-deriving single-date comparisons.
    o['dropAmount'] = int(today_low - yest_low) if (yest_low and yest_low > 0 and today_low > 0) else 0
    o['dropPct'] = round(drop_pct, 1) if (yest_low and yest_low > 0 and today_low > 0) else 0.0
    o['dropPrice'] = int(today_low)

# Garbage-collect stale entries (older than 14 days) — defense in depth
# even though we now clear the stamp immediately on no-drop.
cutoff = (datetime.now() - timedelta(days=FIRST_DETECTED_MAX_AGE_DAYS)).isoformat()
before_gc = len(first_detected_map)
first_detected_map = {k: v for k, v in first_detected_map.items() if v >= cutoff}

output = {"generated": now_iso, "source": "fli_calendar.db", "departure": "SZX", "results": results}
with open(NAS_OUT, "w") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

total_dates = sum(len(r["cheapestDates"]) for r in results)
with_flight = sum(1 for r in results for cd in r["cheapestDates"] if cd.get("flight"))
print(f"\nExported {len(results)} SZX routes to {NAS_OUT}")
print(f"Total cheapestDates: {total_dates}, with flight: {with_flight} ({with_flight/total_dates*100:.0f}%)" if total_dates > 0 else "\nNo data yet")
print(f"First-detected: {stamped} new entries stamped, {cleared} cleared (no longer dropping), {before_gc - len(first_detected_map)} stale entries GC'd")

with open(FIRST_DETECTED_PATH, "w") as f:
    json.dump(first_detected_map, f, indent=2, ensure_ascii=False)
print(f"Updated {FIRST_DETECTED_PATH}")
conn.close()
