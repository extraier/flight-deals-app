#!/usr/bin/env python3
"""
Export HKG flight deals → /data/all_dates.json
Includes historical price comparisons (1d, 4d, 7d ago).
"""
import sqlite3
import json
import os
from datetime import datetime, timedelta

DB_PATH = '/data/fli_calendar.db'

CITY_NAME_CN = {
    'TPE': '台北', 'KHH': '高雄', 'RMQ': '台中',
    'NRT': '東京', 'NGO': '名古屋', 'KIX': '大阪', 'FUK': '福岡', 'CTS': '札幌', 'OKA': '沖繩',
    'ICN': '首爾', 'PUS': '釜山',
    'PVG': '上海', 'PEK': '北京', 'CAN': '廣州', 'SZX': '深圳', 'CTU': '成都', 'XIY': '西安',
    'BKK': '曼谷', 'MNL': '馬尼拉', 'SIN': '新加坡', 'KUL': '吉隆坡',
    'HAN': '河內', 'SGN': '胡志明',
    'CGK': '雅加達', 'DPS': '峇里島', 'RGN': '仰光', 'PEN': '檳城',
    'BOM': '孟買', 'DEL': '德里', 'CMB': '科倫坡',
    'DOH': '多哈', 'DXB': '杜拜', 'CAI': '開羅',
    'LHR': '倫敦', 'CDG': '巴黎', 'AMS': '阿姆斯特丹', 'BCN': '巴塞羅拿', 'MAD': '馬德里',
    'FCO': '羅馬', 'FRA': '法蘭克福', 'MXP': '米蘭',
    'LAX': '洛杉矶', 'SFO': '三藩市', 'ORD': '芝加哥', 'SEA': '西雅圖', 'JFK': '紐約', 'YVR': '溫哥華',
    'SYD': '悉尼', 'MEL': '墨爾本', 'AKL': '奧克蘭',
    'JNB': '約翰內斯堡',
    'CPT': '開普敦',
    'MLE': '馬爾代夫',
    'XMN': '廈門', 'WNZ': '溫州',
    'MCT': '馬斯喀特', 'DMM': '達曼',
    'BKI': '亞庇', 'CJU': '濟州', 'CNX': '清邁', 'CRK': '克拉克', 'CZX': '長沙',
    'DAD': '峴港', 'HIJ': '廣島', 'HKT': '布吉', 'HND': '羽田', 'ISG': '石垣',
    'KMQ': '小松', 'NGB': '寧波', 'NOS': '諾西貝', 'PKX': '北京大興',
    'PQC': '富國島', 'SDJ': '仙台', 'SYX': '三亞', 'SZB': '吉隆坡',
    'TAE': '大邱', 'TAK': '高松', 'WUX': '無錫', 'YIW': '義烏',
}

REGION_CN = {
    'East Asia': '東亞',
    'Southeast Asia': '東南亞',
    'China': '中國',
    'Oceania': '大洋洲',
    'North America': '北美洲',
    'Europe': '歐洲',
    'South Asia': '南亞',
    'Middle East': '中東',
    'Africa': '非洲',
    'South America': '南美洲',
}

# Country → region mapping
COUNTRY_REGION = {
    '台灣': 'East Asia', '日本': 'East Asia', '南韓': 'East Asia',
    '泰國': 'Southeast Asia', '馬來西亞': 'Southeast Asia', '新加坡': 'Southeast Asia',
    '越南': 'Southeast Asia', '印尼': 'Southeast Asia', '緬甸': 'Southeast Asia', '菲律宾': 'Southeast Asia',
    '中國': 'China',
    '英國': 'Europe', '法國': 'Europe', '德國': 'Europe', '意大利': 'Europe',
    '西班牙': 'Europe', '荷蘭': 'Europe', '瑞士': 'Europe', '俄羅斯': 'Europe',
    '美國': 'North America', '加拿大': 'North America',
    '澳洲': 'Oceania', '新西蘭': 'Oceania',
    '印度': 'South Asia', '斯里蘭卡': 'South Asia',
    '阿聯酋': 'Middle East', '卡塔爾': 'Middle East', '沙特阿拉伯': 'Middle East',
    '埃及': 'Africa', '南非': 'Africa', '馬達加斯加': 'Africa',
    '巴西': 'South America', '阿根廷': 'South America',
}

COUNTRY_CN = {
    'TPE': '台灣', 'KHH': '台灣', 'RMQ': '台灣',
    'NRT': '日本', 'NGO': '日本', 'KIX': '日本', 'FUK': '日本', 'CTS': '日本', 'OKA': '日本',
    'ICN': '南韓', 'PUS': '南韓',
    'PVG': '中國', 'PEK': '中國', 'CAN': '中國', 'SZX': '中國', 'CTU': '中國', 'XIY': '中國',
    'BKK': '泰國', 'MNL': '菲律宾', 'SIN': '新加坡', 'KUL': '馬來西亞', 'HAN': '越南', 'SGN': '越南',
    'CGK': '印尼', 'DPS': '印尼', 'RGN': '緬甸', 'PEN': '馬來西亞',
    'BOM': '印度', 'DEL': '印度', 'CMB': '斯里蘭卡',
    'DOH': '卡塔爾', 'DXB': '阿聯酋', 'CAI': '埃及',
    'LHR': '英國', 'CDG': '法國', 'AMS': '荷蘭', 'BCN': '西班牙', 'MAD': '西班牙',
    'FCO': '意大利', 'FRA': '德國', 'MXP': '意大利',
    'LAX': '美國', 'SFO': '美國', 'ORD': '美國', 'SEA': '美國', 'JFK': '美國', 'YVR': '加拿大',
    'SYD': '澳洲', 'MEL': '澳洲', 'AKL': '新西蘭',
    'JNB': '南非', 'CPT': '南非',
    'BKI': '馬來西亞', 'CJU': '南韓', 'CNX': '泰國', 'CRK': '菲律賓',
    'CZX': '中國', 'DAD': '越南', 'HIJ': '日本', 'HKT': '泰國',
    'HND': '日本', 'ISG': '日本', 'KMQ': '日本', 'NGB': '中國',
    'NOS': '馬達加斯加', 'PKX': '中國', 'PQC': '越南', 'SDJ': '日本',
    'SYX': '中國', 'SZB': '馬來西亞', 'TAE': '南韓', 'TAK': '日本',
    'WUX': '中國', 'YIW': '中國',
}
TODAY = datetime.now().strftime('%Y-%m-%d')

# Hermes: staleness threshold for flight_details rows. If a detail row's
# scan_time is older than this, the export falls back to flight_dates for
# the price (flight info is still used if available). Prevents stale
# detail-scanner prices from masking fresh calendar-scanner prices.
# Detail scanner scans one route deeply (1.5s × 100+ dates × 50 routes),
# so individual (route, dep_date) rows can be days old. Calendar scanner
# hits every (route, dep_date) every 50 min, so its prices are always
# calendar scanner wins.
DETAIL_MAX_AGE_HOURS = int(os.environ.get('DETAIL_MAX_AGE_HOURS', '24'))

# Hermes 2026-08-07: separate cap for flight_dates fallback. The detail
# filter only excludes flight_details rows by scan_time; the outer
# flight_dates query had NO scan_time filter, so when the detail scanner
# stopped (shadow-ban / outage), it pulled rows from 2026-06-17 etc.
# Calendar scanner hits each (route, dep_date) every 50 min, so 168h (7d)
# is a sane upper bound — anything older than that the calendar will have
# re-confirmed or removed.
FLIGHT_DATES_MAX_AGE_HOURS = int(os.environ.get('FLIGHT_DATES_MAX_AGE_HOURS', '168'))

conn = sqlite3.connect(DB_PATH, timeout=30)
conn.execute("PRAGMA busy_timeout = 30000")
c = conn.cursor()

# ── Current live prices (flight_details) ──────────────────────────────────
# Hermes: filter out stale rows. Compare scan_time (stored as 'YYYY-MM-DD HH:MM:SS',
# local HKT) against now(). Rows older than DETAIL_MAX_AGE_HOURS hours are
# excluded here, which means the NOT IN subquery below also excludes them,
# and the matching flight_dates row falls through as a fresh-price fallback.
#
# Hermes 2026-08-07: also filter dep_date >= TODAY so past-dated rows
# don't surface as "cheapest" (the page is for future-trip search). When
# the detail scanner is healthy, dep_date filter rarely matters because
# the scanner only writes dep_date >= today. But when shadow-banned /
# stopped, old detail rows accumulated and the exporter was promoting
# 2026-06-27 as BKK's cheapest.
c.execute("""
    SELECT route, dep_date, ret_date, price,
           outbound_airline, outbound_flight, outbound_dep_time, outbound_arr_time,
           return_airline, return_flight, return_dep_time, return_arr_time,
           scan_time
    FROM flight_details
    WHERE departure='HKG'
      AND scan_time >= datetime('now', ?)
      AND dep_date >= ?
    ORDER BY route, dep_date
""", (f'-{DETAIL_MAX_AGE_HOURS} hours', TODAY))
detail_rows = c.fetchall()
print(f"Detail rows (≤{DETAIL_MAX_AGE_HOURS}h old, dep>=today): {len(detail_rows)}")

# ── Fallback: flight_dates with no detail scan ────────────────────────────
# Hermes 2026-08-07: outer query now has TWO filters that were missing:
#   1. scan_time >= -FLIGHT_DATES_MAX_AGE_HOURS (was: not filtered → ancient
#      rows from 2026-06-17 leaked through when detail scanner stopped)
#   2. dep_date >= TODAY (was: not filtered → past dates surfaced as cheapest)
# Without (1), the 2026-08-07 shadow-ban outage caused BKK to keep showing
# a $1,484 row from 2026-07-22 instead of falling back to a recent scan.
c.execute("""
    SELECT route, dep_date, ret_date, price, scan_time
    FROM flight_dates
    WHERE departure='HKG'
      AND scan_time >= datetime('now', ?)
      AND dep_date >= ?
      AND (route, dep_date, ret_date) NOT IN (
          SELECT route, dep_date, ret_date FROM flight_details
          WHERE departure='HKG' AND scan_time >= datetime('now', ?)
      )
    ORDER BY route, dep_date
""", (f'-{FLIGHT_DATES_MAX_AGE_HOURS} hours', TODAY, f'-{DETAIL_MAX_AGE_HOURS} hours'))
fallback_rows = c.fetchall()
print(f"Fallback flight_dates rows (≤{FLIGHT_DATES_MAX_AGE_HOURS}h old, dep>=today): {len(fallback_rows)}")
conn.close()

# ── Historical price map ───────────────────────────────────────────────────
conn2 = sqlite3.connect(DB_PATH, timeout=30)
conn2.execute("PRAGMA busy_timeout = 30000")
c2 = conn2.cursor()

# Get available recorded_dates
c2.execute("SELECT DISTINCT recorded_date FROM historical_prices WHERE departure='HKG' ORDER BY recorded_date")
all_dates = [r[0] for r in c2.fetchall()]
print(f"Historical dates available: {all_dates}")

# Target comparison dates (1, 4, 7 days ago)
today = datetime.now()
targets = {}
for days in [1, 4, 7]:
    d = (today - timedelta(days=days)).strftime('%Y-%m-%d')
    label = f"{days}d"
    targets[label] = d

# Build hist[route][dep_date][label] = price
hist = {}   # hist[route][dep_date][label] = price
for label, rd in targets.items():
    if rd not in all_dates:
        continue
    c2.execute("""
        SELECT route, dep_date, price
        FROM historical_prices
        WHERE departure='HKG' AND recorded_date=?
    """, (rd,))
    for route, dep_date, price in c2.fetchall():
        if route not in hist:
            hist[route] = {}
        if dep_date not in hist[route]:
            hist[route][dep_date] = {}
        hist[route][dep_date][label] = price

conn2.close()

# ── Build detail map ───────────────────────────────────────────────────────
detail_map = {}
for r in detail_rows:
    route, dep_date, ret_date, price = r[0], r[1], r[2], r[3]
    ob_airline, ob_flight = r[4], r[5]
    ob_dep, ob_arr = r[6], r[7]
    ret_airline, ret_flight = r[8], r[9]
    ret_dep, ret_arr = r[10], r[11]
    key = (route, dep_date, ret_date)
    detail_map[key] = {
        'price': price,
        'flight_number': ob_flight,
        'airline': ob_airline,
        'departure_time': ob_dep,
        'arrival_time': ob_arr,
        'return_flight': ret_flight,
    }

# ── Build dates map ────────────────────────────────────────────────────────
dates_map = {}  # route -> {dep_date: {'price': N, 'ret_date': ..., 'flight': {...}, 'hist': {}}}
for r in detail_rows:
    route, dep_date, ret_date, price = r[0], r[1], r[2], r[3]
    ob_airline, ob_flight = r[4], r[5]
    ob_dep, ob_arr = r[6], r[7]
    ret_airline, ret_flight = r[8], r[9]
    ret_dep, ret_arr = r[10], r[11]
    detail_scan_time = r[12]  # Hermes 2026-08-07: see fallback path
    if route not in dates_map:
        dates_map[route] = {}
    h = hist.get(route, {}).get(dep_date, {})
    dates_map[route][dep_date] = {
        'price': price,
        'ret_date': ret_date,
        'flight': {
            'airline': ob_airline,
            'flight_no': ob_flight,
            'dep_time': ob_dep,
            'arr_time': ob_arr,
            'return_airline': ret_airline,
            'return_flight': ret_flight,
            'return_dep_time': ret_dep,
            'return_arr_time': ret_arr,
        },
        'history': h,   # e.g. {'1d': 1300, '4d': 1250}
        'last_verified': detail_scan_time,  # Hermes 2026-08-07: freshness badge
    }

for r in fallback_rows:
    route, dep_date, ret_date, price, scan_time = r
    if route not in dates_map:
        dates_map[route] = {}
    h = hist.get(route, {}).get(dep_date, {})
    dates_map[route][dep_date] = {
        'price': price,
        'ret_date': ret_date,
        'flight': None,
        'history': h,
        'last_verified': scan_time,  # Hermes 2026-08-07: expose scan_time so the page can show "last seen: Nd ago"
    }

# ── Compute typical price per route ────────────────────────────────────────
route_info = {}
for route, dates in dates_map.items():
    prices = [d['price'] for d in dates.values()]
    tip = round(sum(prices) / len(prices)) if prices else 0
    route_info[route] = {
        'typical': tip,
        'count': len(prices),
    }

# ── Assemble output ────────────────────────────────────────────────────────
output = []
for route, dates in dates_map.items():
    info = route_info[route]
    ri = route_info.get(route, {'typical': 0, 'count': 0})
    typical = ri['typical']

    # Collect all unique departure months
    months = sorted(set(int(d['ret_date'].split('-')[1] if d['ret_date'] else '01') for d in dates.values()))

    # Sort dates by price
    sorted_dates = sorted(dates.items(), key=lambda x: x[1]['price'])

    date_list = []
    for dep_date, d in sorted_dates[:30]:
        h = d['history']
        # Compute price changes
        changes = {}
        for label in ['1d', '4d', '7d']:
            if label in h:
                old_price = h[label]
                curr_price = d['price']
                diff = curr_price - old_price
                pct = round(diff / old_price * 100, 1) if old_price else 0
                changes[label] = {'price': old_price, 'diff': diff, 'pct': pct}

        dep_y, dep_m, dep_d = dep_date.split('-')
        ret = d['ret_date']
        ret_y, ret_m, ret_d = ret.split('-')
        f = d['flight']

        entry = {
            'day': int(dep_d), 'month': int(dep_m), 'year': int(dep_y),
            'price': d['price'],
            'stay': (datetime.strptime(ret, '%Y-%m-%d') - datetime.strptime(dep_date, '%Y-%m-%d')).days,
            'history': changes,
            'flight': None,
            'last_verified': d.get('last_verified'),  # Hermes 2026-08-07: freshness badge (ISO string or None)
        }
        if f:
            entry['flight'] = {
                'airline': f['airline'],
                'flight_no': f['flight_no'],
                'dep_time': f['dep_time'],
                'arr_time': f['arr_time'],
                'return_airline': f['return_airline'],
                'return_flight': f['return_flight'],
                'return_dep_time': f['return_dep_time'],
                'return_arr_time': f['return_arr_time'],
            }
        date_list.append(entry)

    # Route destination
    code = route.split('→')[1]
    city_name = CITY_NAME_CN.get(code, code)
    country = COUNTRY_CN.get(code, '')
    region_en = COUNTRY_REGION.get(country, 'East Asia')
    region = REGION_CN.get(region_en, '東亞')
    output.append({
        'route': route,
        'destination': {'code': code, 'name': f'{city_name} ({code})', 'region': region},
        'price': sorted_dates[0][1]['price'] if sorted_dates else 0,
        'typicalPrice': typical,
        'cheapestDates': date_list,
        'totalDates': len(dates),
        'totalDestinations': len(output),
    })

output.sort(key=lambda x: x['price'])
for o in output:
    o['totalDestinations'] = len(output)

# ── Compute destination-level drops + firstDetected + pendingScans ─────────
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
#
# Hermes 2026-07-09: pendingScans stamp. For routes that don't have a
# confirmed drop (because the cheapest date lacks a history.1d baseline
# — the detail scanner hasn't processed it yet) but whose calendar price
# is well below typical, stamp `pendingScans: <N>` so the deals page can
# render them in a "Pending" state. This closes the gap where the calendar
# scanner detects a price change but the detail scanner hasn't confirmed
# it yet (typically 10-60 s). The N is the number of top-30 cheapest dates
# that are missing detail/baseline — a heuristic signal for "still scanning".
FIRST_DETECTED_PATH = '/data/drop_first_detected.json'
FIRST_DETECTED_MAX_AGE_DAYS = 14
# Hermes 2026-07-09: if calendar price is <= this fraction of typical, we
# call it a likely drop even without baseline confirmation. 0.85 matches
# the Telegram "🟢 平過典型" threshold (15% below typical), but applied
# here to the *cheapest* date as a soft drop signal.
PENDING_PRICE_RATIO = 0.85
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
pending = 0
for o in output:
    dates = o.get('cheapestDates') or []
    if not dates:
        o['firstDetected'] = None
        o['dropAmount'] = 0
        o['dropPct'] = 0
        o['dropPrice'] = 0
        o['pendingScans'] = 0
        continue
    # Hermes 2026-07-30: use the cheapest date's OWN baseline with 1d -> 4d
    # -> 7d fallback. Previously this used destination-level `min(all
    # baselines)` which collapses to 0 when any sibling date's baseline
    # equals today's price — masking real drops like PKX where the
    # cheapest date (2026-10-14, $993) had 7d=$1033 (-$40) but another
    # date's 7d=$993 diluted the destination-level min. Telegram reads
    # per-date so this fix brings /deals into agreement.
    today_low = (dates[0].get('price') or 0) if dates else 0
    yest_low = None
    yest_period = None
    for _p in ('1d', '4d', '7d'):
        _bp = (dates[0].get('history') or {}).get(_p, {}).get('price') if dates else None
        if _bp and _bp > 0:
            yest_low = _bp
            yest_period = _p
            break
    drop_pct = ((today_low - yest_low) / yest_low * 100) if (yest_low and yest_low > 0 and today_low > 0) else 0

    key = f"HKG→{o.get('destination', {}).get('code', '')}"
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
    # Hermes 2026-08-07: only stamp when there is actually a real drop
    # (today_low < yest_low AND pct <= -1.0). Previously this stamped the
    # raw difference even when price increased vs yesterday, which produced
    # mixed-sign entries (e.g. ICN dropAmount=1, dropPct=+0.1) that the
    # client's "dropPct < 1 absolute" filter didn't catch — they sat in the
    # JSON as positive drops when really the price had rebounded.
    if drop_pct <= -1.0 and today_low > 0 and yest_low and yest_low > 0:
        # Sign convention: dropAmount is negative (price went DOWN by this
        # amount), dropPct is negative (percent change). The client's
        # buildDropList handles both legacy (positive dropAmount) and
        # current (negative dropAmount) conventions by checking both signs.
        o['dropAmount'] = int(today_low - yest_low)  # negative
        o['dropPct'] = round(drop_pct, 1)            # negative
        o['dropPrice'] = int(today_low)              # today's price
    else:
        # No active drop — clear all drop fields so the JSON only contains
        # real drops. This avoids the ICN/FRA-style mixed-sign entries that
        # pollute the data with "price went up but it's still stamped as a drop".
        o['dropAmount'] = 0
        o['dropPct'] = 0
        o['dropPrice'] = 0

    # Hermes 2026-07-09: pendingScans = how many of the top-N cheapest dates
    # still need detail-scan confirmation (no flight info, no history.1d
    # baseline). Only count it for routes that are likely drops (price well
    # below typical) but not yet confirmed. This is the signal the deals
    # page uses to render a "Pending" badge while the detail scanner
    # catches up.
    if drop_pct > -1.0:  # i.e. NOT a confirmed drop
        typical = o.get('typicalPrice') or 0
        if typical > 0 and today_low > 0 and today_low <= typical * PENDING_PRICE_RATIO:
            # Count how many of the cheapest dates lack detail or baseline.
            # Top 8 is enough — these are the cheapest, most likely drops.
            n_pending = sum(
                1 for cd in sorted(dates, key=lambda x: x.get('price', 99999))[:8]
                if not cd.get('flight') and not (cd.get('history') or {}).get('1d', {}).get('price')
            )
            o['pendingScans'] = n_pending
            if n_pending > 0:
                pending += 1
            # Hermes 2026-07-09: also keep a baseline "firstDetected"-like
            # timestamp for pending routes, so the deals page can show
            # "spotted 30 秒前" recency. We use a separate field so we
            # don't pollute the confirmed-drop firstDetected store.
            o['pendingFirstSeen'] = now_iso
        else:
            o['pendingScans'] = 0
            o['pendingFirstSeen'] = None
    else:
        # Already a confirmed drop — pendingScans is moot but we still
        # stamp 0 so the client has a defined shape.
        o['pendingScans'] = 0
        o['pendingFirstSeen'] = None

# Garbage-collect stale entries (older than 14 days) — defense in depth
# even though we now clear the stamp immediately on no-drop.
cutoff = (datetime.now() - timedelta(days=FIRST_DETECTED_MAX_AGE_DAYS)).isoformat()
before_gc = len(first_detected_map)
first_detected_map = {k: v for k, v in first_detected_map.items() if v >= cutoff}

print(f"Routes: {len(output)}, Dates: {sum(len(o['cheapestDates']) for o in output)}")
print(f"First-detected: {stamped} new entries stamped, {cleared} cleared (no longer dropping), {before_gc - len(first_detected_map)} stale entries GC'd")
print(f"Pending scans: {pending} route(s) waiting for detail confirmation")

with open('/data/all_dates.json', 'w') as f:
    json.dump({'results': output, 'generated': now_iso}, f, default=str, ensure_ascii=False)
print("Written /data/all_dates.json")

with open(FIRST_DETECTED_PATH, 'w') as f:
    json.dump(first_detected_map, f, indent=2, ensure_ascii=False)
print(f"Written {FIRST_DETECTED_PATH}")
