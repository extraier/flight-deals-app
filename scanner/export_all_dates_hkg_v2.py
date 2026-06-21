#!/usr/bin/env python3
"""
Export HKG flight deals → /data/all_dates.json
Includes historical price comparisons (1d, 4d, 7d ago).
"""
import sqlite3
import json
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
    '埃及': 'Africa', '南非': 'Africa',
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
}
TODAY = datetime.now().strftime('%Y-%m-%d')

conn = sqlite3.connect(DB_PATH, timeout=30)
conn.execute("PRAGMA busy_timeout = 30000")
c = conn.cursor()

# ── Current live prices (flight_details) ──────────────────────────────────
c.execute("""
    SELECT route, dep_date, ret_date, price,
           outbound_airline, outbound_flight, outbound_dep_time, outbound_arr_time,
           return_airline, return_flight, return_dep_time, return_arr_time,
           scan_time
    FROM flight_details
    WHERE departure='HKG'
    ORDER BY route, dep_date
""")
detail_rows = c.fetchall()

# ── Fallback: flight_dates with no detail scan ────────────────────────────
c.execute("""
    SELECT route, dep_date, ret_date, price
    FROM flight_dates
    WHERE departure='HKG'
      AND (route, dep_date, ret_date) NOT IN (
          SELECT route, dep_date, ret_date FROM flight_details WHERE departure='HKG'
      )
    ORDER BY route, dep_date
""")
fallback_rows = c.fetchall()
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
    }

for r in fallback_rows:
    route, dep_date, ret_date, price = r
    if route not in dates_map:
        dates_map[route] = {}
    h = hist.get(route, {}).get(dep_date, {})
    dates_map[route][dep_date] = {
        'price': price,
        'ret_date': ret_date,
        'flight': None,
        'history': h,
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

print(f"Routes: {len(output)}, Dates: {sum(len(o['cheapestDates']) for o in output)}")
with open('/data/all_dates.json', 'w') as f:
    json.dump({'results': output, 'generated': datetime.now().isoformat()}, f, default=str, ensure_ascii=False)
print("Written /data/all_dates.json")
