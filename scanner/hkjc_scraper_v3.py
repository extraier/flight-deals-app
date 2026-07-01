#!/usr/bin/env python3
"""
HKJC + Polymarket Odds Scanner v3
- Match Polymarket games with HKJC matches
- Show up/down trend vs last hour
- Traditional Chinese + HKT time
"""
import json
import requests
import base64
import zlib
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Config
WP_USER = "Comparetiger"
WP_APP_PASSWORD = "ohWl WFCL g0rd RwJo kqle Ibep"
WP_PAGE_ID = "99999"
HKJC_URL = "https://info.cld.hkjc.com/graphql/base/"
HISTORY_DIR = "/tmp/odds_history"
HISTORY_DAYS = 30  # Keep 30 days of history

# Team Chinese name mapping (Polymarket English -> Chinese)
TEAM_CN = {
    "Mexico": "墨西哥",
    "South Africa": "南非",
    "Korea Republic": "南韓",
    "Czechia": "捷克",
    "Canada": "加拿大",
    "Bosnia-Herzegovina": "波斯尼亞",
    "United States": "美國",
    "USA": "美國",
    "Paraguay": "巴拉圭",
    "Qatar": "卡塔爾",
    "Switzerland": "瑞士",
    "Germany": "德國",
    "Scotland": "蘇格蘭",
    "Hungary": "匈牙利",
    "Portugal": "葡萄牙",
    "Argentina": "阿根廷",
    "Brazil": "巴西",
    "Croatia": "克羅地亞",
    "Albania": "阿爾巴尼亞",
    "Spain": "西班牙",
    "France": "法國",
    "Belgium": "比利時",
    "Slovakia": "斯洛伐克",
    "Romania": "羅馬尼亞",
    "Austria": "奧地利",
    "England": "英格蘭",
    "Serbia": "塞爾維亞",
    "Slovenia": "斯洛文尼亞",
    "Italy": "意大利",
    "Netherlands": "荷蘭",
    "Poland": "波蘭",
    "Denmark": "丹麥",
    "Sweden": "瑞典",
    "Japan": "日本",
    "Australia": "澳洲",
    "New Zealand": "新西蘭",
    "Nigeria": "尼日利亞",
    "Iceland": "冰島",
    "Wales": "威爾斯",
    "Ukraine": "烏克蘭",
    "Colombia": "哥倫比亞",
    "Peru": "秘魯",
    "Chile": "智利",
    "Ecuador": "厄瓜多爾",
    "Uruguay": "烏拉圭",
    "Venezuela": "委內瑞拉",
    "Costa Rica": "哥斯達黎加",
    "Panama": "巴拿馬",
    "Honduras": "洪都拉斯",
    "Jamaica": "牙買加",
    "El Salvador": "薩爾瓦多",
    "Ghana": "加納",
    "Cameroon": "喀麥隆",
    "Senegal": "塞內加爾",
    "Morocco": "摩洛哥",
    "Egypt": "埃及",
    "Algeria": "阿爾及利亞",
    "Tunisia": "突尼斯",
    "Côte d'Ivoire": "科特迪瓦",
    "Ivory Coast": "科特迪瓦",
    "DR Congo": "剛果民主共和國",
    "Congo": "剛果",
    "Zambia": "贊比亞",
    "South Sudan": "南蘇丹",
    "Sudan": "蘇丹",
    "Angola": "安哥拉",
    "Mozambique": "莫桑比克",
    "Kenya": "肯雅",
    "Ethiopia": "埃塞俄比亞",
    "Tanzania": "坦桑尼亞",
    "Uganda": "烏干達",
    "Gabon": "加蓬",
    "Zimbabwe": "津巴布韋",
    "Botswana": "博茨瓦納",
    "Namibia": "納米比亞",
    "Mali": "馬里",
    "Burkina Faso": "布基納法索",
    "Guinea": "畿內亞",
    "Haiti": "海地",
    "Saudi Arabia": "沙特阿拉伯",
    "IR Iran": "伊朗",
    "Iran": "伊朗",
    "Iraq": "伊拉克",
    "Norway": "挪威",
    "Jordan": "約旦",
    "Uzbekistan": "烏茲別克",
    "Curaçao": "古拉索",
    "Cabo Verde": "佛得角",
    "Cape Verde Islands": "佛得角",
    "Türkiye": "土耳其",
    "Turkey": "土耳其",
}

# Team alias mapping (HKJC name -> Polymarket name) for matching
TEAM_ALIAS = {
    "USA": "United States",
    "IR Iran": "Iran",
    "Türkiye": "Turkey",
    "Turkiye": "Turkey",  # HKJC uses "Turkiye" without umlaut
    "Curacao": "Curaçao",
    "Cape Verde Islands": "Cabo Verde",
    "Cote d'Ivoire": "Côte d'Ivoire",
    "D R Congo": "DR Congo",  # HKJC uses "D R Congo", Polymarket uses "DR Congo"
    "Bosnia-Herzegovina": "Bosnia and Herzegovina",  # HKJC uses hyphen, Polymarket uses "and"
}

def get_team_cn(name):
    """Get Chinese name for a team."""
    return TEAM_CN.get(name, '')

def normalize_team(name):
    """Normalize team name for matching."""
    name = name.strip()
    # Use alias if available (HKJC name -> Polymarket name)
    if name in TEAM_ALIAS:
        name = TEAM_ALIAS[name]
    # Lowercase and remove special chars
    normalized = ''.join(c.lower() for c in name if c.isalnum() or c.isspace())
    return normalized

def find_hkjc_match(poly_home, poly_away, hkjc_matches):
    """Find HKJC match that corresponds to Polymarket game."""
    poly_home_norm = normalize_team(poly_home)
    poly_away_norm = normalize_team(poly_away)
    
    for m in hkjc_matches:
        hkjc_home = normalize_team(m.get('home', ''))
        hkjc_away = normalize_team(m.get('away', ''))
        
        # Check if teams match (in either order for friendly matches)
        home_match = (poly_home_norm in hkjc_home or hkjc_home in poly_home_norm)
        away_match = (poly_away_norm in hkjc_away or hkjc_away in poly_away_norm)
        
        if home_match and away_match:
            return m
        
        # Also check reversed (neutral venue matches)
        home_match2 = (poly_home_norm in hkjc_away or hkjc_away in poly_home_norm)
        away_match2 = (poly_away_norm in hkjc_home or hkjc_home in poly_away_norm)
        
        if home_match2 and away_match2:
            return m
    
    return None

def get_hkjc_matches():
    """Fetch all football matches from HKJC."""
    with open('/app/exact_query.txt', 'r') as f:
        query = f.read()

    variables = {
        "fbOddsTypes": ["HAD", "HDC", "HIL", "CRS"],
        "fbOddsTypesM": ["HAD", "HDC", "HIL", "CRS"],
        "startDate": None, "endDate": None, "tournIds": ["50068132"],  # WC Finals (World Cup)
        "matchIds": None,
        "featuredMatchesOnly": False, "frontEndIds": None, "earlySettlementOnly": False,
        "showAllMatch": True, "startIndex": None, "endIndex": None
    }

    headers = {
        "Content-Type": "application/json",
        "Accept": "*/*",
        "User-Agent": "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)"
    }

    response = requests.post(HKJC_URL, json={"query": query, "variables": variables}, headers=headers, timeout=30)
    data = response.json()
    return data.get("data", {}).get("matches", [])

def process_hkjc_matches(matches):
    """Process HKJC matches into structured data."""
    processed = []
    
    for m in matches:
        home_team = m.get("homeTeam") or {}
        away_team = m.get("awayTeam") or {}
        
        home_en = home_team.get("name_en") or "Unknown"
        away_en = away_team.get("name_en") or "Unknown"
        home_ch = home_team.get("name_ch") or ""
        away_ch = away_team.get("name_ch") or ""
        
        # Get HAD odds
        pools = m.get("foPools") or []
        had_pool = None
        for p in pools:
            if p.get("oddsType") == "HAD":
                had_pool = p
                break
        
        home_odds = None
        draw_odds = None
        away_odds = None
        
        if had_pool:
            lines = had_pool.get("lines") or []
            if lines and len(lines) > 0:
                first_line = lines[0]
                if first_line:
                    combs = first_line.get("combinations") or []
                    for comb in combs:
                        sel_str = comb.get("str", "")
                        odds = comb.get("currentOdds")
                        
                        if sel_str == "H":
                            home_odds = float(odds) if odds else None
                        elif sel_str == "D":
                            draw_odds = float(odds) if odds else None
                        elif sel_str == "A":
                            away_odds = float(odds) if odds else None
        
        # Convert kickoff time to HKT
        kickoff = m.get("kickOffTime", "")
        
        processed.append({
            "home": home_en,
            "away": away_en,
            "home_ch": home_ch,
            "away_ch": away_ch,
            "kickoff": kickoff,
            "tournament": (m.get("tournament") or {}).get("name_en", ""),
            "home_odds": home_odds,
            "draw_odds": draw_odds,
            "away_odds": away_odds
        })
    
    return processed

def get_polymarket_data():
    """Fetch Polymarket per-game 1x2 markets via Gamma API.

    Polymarket per-game slugs follow pattern `fifwc-XXX-YYY-2026-MM-DD`. Each
    event has three markets: Home win / Draw / Away win. The combination of
    `series_slug=soccer-fifwc&closed=false&active=true` returns the upcoming
    unplayed knockout-stage games; we then drop ancillary markets
    (player-props, exact-score, halftime, etc.) by slug filter.

    Replaces the 2025 `_next/data/build-XXX/...` endpoint whose build hash
    became stale in June 2026 (returns HTML not JSON, so json.loads throws).
    """
    from datetime import datetime, timezone, timedelta

    list_url = (
        "https://gamma-api.polymarket.com/events"
        "?series_slug=soccer-fifwc&closed=false&active=true&limit=500"
    )
    req = urllib.request.Request(list_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as response:
        events = json.loads(response.read().decode())

    games = []
    ANCILLARY = ('player-props', 'exact-score', 'halftime', 'second-half',
                 'total-corners', 'first-to-score', 'more-markets', 'spread')
    for ev in events:
        slug = ev.get('slug', '')
        title = ev.get('title', '')
        if not slug.startswith('fifwc-'):
            continue
        if any(x in slug for x in ANCILLARY):
            continue
        if ' vs. ' not in title:
            continue

        home_team, away_team = title.split(' vs. ', 1)

        # For per-game events, `endDate` is the kickoff UTC time (market
        # resolution time = kickoff for sport markets). `startTime` is also
        # present in newer events and is more reliable.
        start_time_hkt = ''
        raw_dt = ev.get('startTime') or ev.get('endDate') or ''
        if raw_dt:
            try:
                dt = datetime.fromisoformat(raw_dt.replace('Z', '+00:00'))
                dt_hkt = dt.astimezone(timezone(timedelta(hours=8)))
                start_time_hkt = dt_hkt.strftime('%m/%d %H:%M')
            except Exception:
                pass

        home_odds = draw_odds = away_odds = None
        for m in ev.get('markets', []):
            q = m.get('question', '') or ''
            outcomes = m.get('outcomes', [])
            prices = m.get('outcomePrices', [])
            if not outcomes or not prices:
                continue
            # Gamma returns both as JSON-encoded strings: '["0.185","0.815"]'
            if isinstance(prices, str):
                try:
                    prices = json.loads(prices)
                except Exception:
                    continue
            if isinstance(outcomes, str):
                try:
                    outcomes = json.loads(outcomes)
                except Exception:
                    continue
            try:
                p_yes = float(prices[0])
            except Exception:
                continue
            group = (m.get('groupItemTitle') or '').lower()
            if 'draw' in group:
                draw_odds = p_yes
                continue
            q_low = q.lower()
            if home_team.lower() in q_low and ' win ' in q_low:
                home_odds = p_yes
            elif away_team.lower() in q_low and ' win ' in q_low:
                away_odds = p_yes

        if home_odds is not None and draw_odds is not None and away_odds is not None:
            games.append({
                'home': home_team,
                'away': away_team,
                'home_odds': home_odds,
                'draw_odds': draw_odds,
                'away_odds': away_odds,
                'start_time_hkt': start_time_hkt,
            })

    return games

def get_history_filename(date_str=None):
    """Get history filename for a specific date."""
    if date_str is None:
        date_str = datetime.now().strftime('%Y-%m-%d')
    return Path(HISTORY_DIR) / f"odds_{date_str}.json"

def load_hourly_history(hours_ago=1):
    """Load odds from N hours ago."""
    hkt_tz_local = timezone(timedelta(hours=8))
    now = datetime.now(hkt_tz_local)
    target_time = now - timedelta(hours=hours_ago)
    target_date_str = target_time.strftime('%Y-%m-%d')
    target_file = get_history_filename(target_date_str)
    
    if not target_file.exists():
        return {}
    
    try:
        with open(target_file, 'r') as f:
            all_entries = json.load(f)
        
        target_ts = target_time.timestamp()
        best_entry = None
        best_diff = float('inf')
        
        for entry in all_entries:
            entry_ts = entry.get('timestamp', 0)
            diff = abs(entry_ts - target_ts)
            if diff < best_diff and diff < 7200:  # Within 2 hours (for better data retrieval)
                best_diff = diff
                best_entry = entry
        
        if best_entry:
            return best_entry.get('odds', {})
        return {}
    except Exception as e:
        print(f"Error loading history: {e}")
        return {}

def load_history():
    """Load last hour's odds for comparison (legacy compatibility)."""
    return load_hourly_history(hours_ago=1)

def save_history(current_odds):
    """Save current odds to daily history file."""
    Path(HISTORY_DIR).mkdir(parents=True, exist_ok=True)
    
    hkt_tz_local = timezone(timedelta(hours=8))
    now = datetime.now(hkt_tz_local)
    date_str = now.strftime('%Y-%m-%d')
    history_file = get_history_filename(date_str)
    
    # Load existing entries for today
    if history_file.exists():
        try:
            with open(history_file, 'r') as f:
                all_entries = json.load(f)
        except:
            all_entries = []
    else:
        all_entries = []
    
    # Add new entry with timestamp
    entry = {
        'timestamp': now.timestamp(),
        'datetime': now.strftime('%Y-%m-%d %H:%M:%S'),
        'odds': current_odds
    }
    all_entries.append(entry)
    
    # Save updated entries
    with open(history_file, 'w') as f:
        json.dump(all_entries, f, indent=2, default=str)
    
    # Clean up old entries (keep only last 7 days)
    cleanup_old_history()

def cleanup_old_history():
    """Remove history files older than HISTORY_DAYS."""
    try:
        cutoff = datetime.now() - timedelta(days=HISTORY_DAYS)
        for f in Path(HISTORY_DIR).glob('odds_*.json'):
            try:
                file_date = datetime.strptime(f.stem.replace('odds_', ''), '%Y-%m-%d')
                if file_date < cutoff:
                    f.unlink()
                    print(f"   清理舊歷史: {f.name}")
            except:
                pass
    except Exception as e:
        print(f"Cleanup error: {e}")

def format_trend(current, previous):
    """Format trend indicator with percentage."""
    if current is None or previous is None or previous == 0:
        return ("—", "neutral")
    
    change = current - previous
    pct = (change / previous) * 100
    
    if abs(pct) < 0.5:  # Less than 0.5% change
        return ("→", "neutral")
    elif pct > 0:
        return (f"↑{abs(pct):.1f}%", "up")
    else:
        return (f"↓{abs(pct):.1f}%", "down")

def format_time(hkt_time_str):
    """Format time string to HKJC-style HKT format: 06月12日 03:00"""
    if not hkt_time_str:
        return "—"
    
    # If already formatted in HKJC style (e.g., "06月12日 03:00"), return as-is
    if '月' in hkt_time_str:
        return hkt_time_str
    
    # If in "06/13 09:00" format (from Polymarket), convert to HKJC style
    if '/' in hkt_time_str and ':' in hkt_time_str:
        try:
            parts = hkt_time_str.split(' ')
            date_part = parts[0]  # "06/13"
            time_part = parts[1] if len(parts) > 1 else "00:00"
            month, day = date_part.split('/')
            return f"{month}月{int(day):02d}日 {time_part}"
        except:
            pass
    
    # Handle ISO format with timezone (e.g., "2026-06-12T03:00:00.000+08:00")
    try:
        dt_str = hkt_time_str.replace('Z', '+00:00')
        dt = datetime.fromisoformat(dt_str)
        return dt.strftime('%m月%d日 %H:%M')
    except:
        pass
    
    # Try UTC parsing
    try:
        dt = datetime.fromisoformat(hkt_time_str.replace('Z', '+00:00'))
        hkt_tz = timezone(timedelta(hours=8))
        dt_hkt = dt.replace(tzinfo=timezone.utc).astimezone(hkt_tz)
        return dt_hkt.strftime('%m月%d日 %H:%M')
    except:
        return hkt_time_str

def main():
    print("=" * 60)
    print("📊 賽事赔率比較 (HKJC vs Polymarket) v3")
    print("=" * 60)
    
    # Load historical data
    history = load_history()
    
    # Get current time in HKT
    hkt_tz = timezone(timedelta(hours=8))
    now_hkt = datetime.now(hkt_tz)
    now_str = now_hkt.strftime('%Y-%m-%d %H:%M')
    
    # Get HKJC data
    print("\n🏇 讀取馬會赔率...")
    try:
        raw_matches = get_hkjc_matches()
        hkjc_games = process_hkjc_matches(raw_matches)
        print(f"   馬會: {len(hkjc_games)} 場賽事")
    except Exception as e:
        print(f"   錯誤: {e}")
        import traceback
        traceback.print_exc()
        hkjc_games = []
    
    # Get Polymarket data
    print("\n🎯 讀取 Polymarket 赔率...")
    try:
        poly_games = get_polymarket_data()
        print(f"   Polymarket: {len(poly_games)} 場賽事")
    except Exception as e:
        print(f"   錯誤: {e}")
        poly_games = []
    
    # Match games
    print("\n🔗 對照賽事...")
    matched_games = []
    current_odds = {}
    
    for poly in poly_games:
        hkjc = find_hkjc_match(poly['home'], poly['away'], hkjc_games)
        
        key = f"{poly['home']} vs {poly['away']}"
        prev = history.get(key, {})
        
        # Get historical data for different time periods
        history_1h = load_hourly_history(1)
        history_6h = load_hourly_history(6)
        history_24h = load_hourly_history(24)
        
        prev_1h = history_1h.get(key, {})
        prev_6h = history_6h.get(key, {})
        prev_24h = history_24h.get(key, {})
        
        # Get HKJC odds for trend calculation
        hkjc_home_val = hkjc.get('home_odds') if hkjc else None
        hkjc_draw_val = hkjc.get('draw_odds') if hkjc else None
        hkjc_away_val = hkjc.get('away_odds') if hkjc else None
        
        # Calculate trends for HKJC (1 hour comparison) - HKJC odds vs HKJC odds
        home_trend_hkjc = format_trend(hkjc_home_val, prev_1h.get('hkjc_home'))
        draw_trend_hkjc = format_trend(hkjc_draw_val, prev_1h.get('hkjc_draw'))
        away_trend_hkjc = format_trend(hkjc_away_val, prev_1h.get('hkjc_away'))
        
        # Calculate trends for Polymarket (1 hour comparison) - Poly prob vs Poly prob
        poly_home_trend = format_trend(poly['home_odds'], prev_1h.get('poly_home'))
        poly_draw_trend = format_trend(poly['draw_odds'], prev_1h.get('poly_draw'))
        poly_away_trend = format_trend(poly['away_odds'], prev_1h.get('poly_away'))
        
        # Calculate 6-hour trends
        home_trend_6h = format_trend(hkjc_home_val, prev_6h.get('hkjc_home'))
        draw_trend_6h = format_trend(hkjc_draw_val, prev_6h.get('hkjc_draw'))
        away_trend_6h = format_trend(hkjc_away_val, prev_6h.get('hkjc_away'))
        
        # Calculate 24-hour trends
        home_trend_24h = format_trend(hkjc_home_val, prev_24h.get('hkjc_home'))
        draw_trend_24h = format_trend(hkjc_draw_val, prev_24h.get('hkjc_draw'))
        away_trend_24h = format_trend(hkjc_away_val, prev_24h.get('hkjc_away'))
        
        match = {
            'home': poly['home'],
            'away': poly['away'],
            'home_ch': hkjc.get('home_ch', '') if hkjc else '',
            'away_ch': hkjc.get('away_ch', '') if hkjc else '',
            'kickoff': hkjc.get('kickoff', '') if hkjc else '',
            'poly_start_time': poly.get('start_time_hkt', ''),
            'hkjc_home_odds': hkjc.get('home_odds') if hkjc else None,
            'hkjc_draw_odds': hkjc.get('draw_odds') if hkjc else None,
            'hkjc_away_odds': hkjc.get('away_odds') if hkjc else None,
            'poly_home': poly['home_odds'],
            'poly_draw': poly['draw_odds'],
            'poly_away': poly['away_odds'],
            'home_trend': home_trend_hkjc,
            'draw_trend': draw_trend_hkjc,
            'away_trend': away_trend_hkjc,
            'poly_home_trend': poly_home_trend,
            'poly_draw_trend': poly_draw_trend,
            'poly_away_trend': poly_away_trend,
            'home_trend_6h': home_trend_6h,
            'draw_trend_6h': draw_trend_6h,
            'away_trend_6h': away_trend_6h,
            'home_trend_24h': home_trend_24h,
            'draw_trend_24h': draw_trend_24h,
            'away_trend_24h': away_trend_24h,
            'matched': hkjc is not None
        }
        matched_games.append(match)
        
        # Save current odds for history
        current_odds[key] = {
            'hkjc_home': hkjc.get('home_odds') if hkjc else None,
            'hkjc_draw': hkjc.get('draw_odds') if hkjc else None,
            'hkjc_away': hkjc.get('away_odds') if hkjc else None,
            'poly_home': poly['home_odds'],
            'poly_draw': poly['draw_odds'],
            'poly_away': poly['away_odds'],
            'timestamp': now_str
        }
    
    # Save history
    save_history(current_odds)
    
    # Generate HTML
    now_hkt_str = now_hkt.strftime('%Y年%m月%d日 %H:%M HKT')
    
    matched_count = sum(1 for g in matched_games if g['matched'])
    
    html = f"""<div style="font-family: Arial, sans-serif; max-width: 1100px; margin: 20px auto;">
<h2 style="color: #1a1a2e;">📊 世界盃賽事赔率比較</h2>
<p style="color: #666;">更新時間：{now_hkt_str}</p>
<p style="color: #888; margin-bottom: 10px;">馬會有 {matched_count} 場 | Polymarket {len(matched_games)} 場 | 🟢=馬會赔率 | 🔵=Polymarket 概率</p>

<div style="margin-bottom: 15px;">
    <span style="color: #666; margin-right: 10px;">比較：</span>
    <select onchange="showComparison(this.value)" style="padding: 8px 12px; border-radius: 5px; border: 1px solid #ccc; background: white; cursor: pointer;">
        <option value="1h">1小時前</option>
        <option value="6h">6小時前</option>
        <option value="24h">24小時前</option>
    </select>
</div>

<table id="odds-table" style="width: 100%; border-collapse: collapse; margin-top: 15px;">
<tr style="background: #1a1a2e; color: white;">
    <th style="padding: 12px 8px; text-align: left;">賽事</th>
    <th style="padding: 12px 8px; text-align: center;"></th>
    <th style="padding: 12px 8px; text-align: center;">主勝</th>
    <th style="padding: 12px 8px; text-align: center;">和局</th>
    <th style="padding: 12px 8px; text-align: center;">客勝</th>
</tr>
"""
    
    for g in matched_games:
        home = g['home']
        away = g['away']
        
        home_ch = g.get('home_ch', '') or get_team_cn(g['home'])
        away_ch = g.get('away_ch', '') or get_team_cn(g['away'])
        
        # Use HKJC kickoff if available, otherwise use Polymarket, then format
        raw_kickoff = g.get('kickoff') or g.get('poly_start_time') or ''
        kickoff = format_time(raw_kickoff) if raw_kickoff else '—'
        
        # Color coding
        bg_color = "#f8f9fa" if g['matched'] else "#fff3cd"
        
        # HKJC style: Chinese name only, bold
        if home_ch:
            home_display = f"<b>{home_ch}</b>"
        else:
            home_display = f"<b>{home}</b>"
        if away_ch:
            away_display = f"<b>{away_ch}</b>"
        else:
            away_display = f"<b>{away}</b>"
        
        # Format HKJC odds with trend
        def fmt_odds(val, trend):
            if val is None:
                return ("—", "—")
            formatted = f"{val:.2f}"
            trend_icon, trend_class = trend
            return (formatted, trend_icon)
        
        hkjc_home, hkjc_home_trend = fmt_odds(g['hkjc_home_odds'], g['home_trend'])
        hkjc_draw, hkjc_draw_trend = fmt_odds(g['hkjc_draw_odds'], g['draw_trend'])
        hkjc_away, hkjc_away_trend = fmt_odds(g['hkjc_away_odds'], g['away_trend'])
        
        # HKJC implied probability (1/odds * 100)
        hkjc_home_pct = int(100 / g['hkjc_home_odds']) if g['hkjc_home_odds'] else None
        hkjc_draw_pct = int(100 / g['hkjc_draw_odds']) if g['hkjc_draw_odds'] else None
        hkjc_away_pct = int(100 / g['hkjc_away_odds']) if g['hkjc_away_odds'] else None
        
        # Polymarket (probability)
        poly_home_pct = int(g['poly_home'] * 100)
        poly_draw_pct = int(g['poly_draw'] * 100)
        poly_away_pct = int(g['poly_away'] * 100)
        
        poly_home_trend_icon, _ = g['poly_home_trend']
        poly_draw_trend_icon, _ = g['poly_draw_trend']
        poly_away_trend_icon, _ = g['poly_away_trend']
        
        # Extract trends for all periods
        home_1h = g['home_trend'][0] if g['home_trend'][0] != '—' else ''
        home_6h = g.get('home_trend_6h', ('—', 'neutral'))[0]
        home_6h = home_6h if home_6h != '—' else ''
        home_24h = g.get('home_trend_24h', ('—', 'neutral'))[0]
        home_24h = home_24h if home_24h != '—' else ''
        
        draw_1h = g['draw_trend'][0] if g['draw_trend'][0] != '—' else ''
        draw_6h = g.get('draw_trend_6h', ('—', 'neutral'))[0]
        draw_6h = draw_6h if draw_6h != '—' else ''
        draw_24h = g.get('draw_trend_24h', ('—', 'neutral'))[0]
        draw_24h = draw_24h if draw_24h != '—' else ''
        
        away_1h = g['away_trend'][0] if g['away_trend'][0] != '—' else ''
        away_6h = g.get('away_trend_6h', ('—', 'neutral'))[0]
        away_6h = away_6h if away_6h != '—' else ''
        away_24h = g.get('away_trend_24h', ('—', 'neutral'))[0]
        away_24h = away_24h if away_24h != '—' else ''
        
        html += f"""<tr style="background: {bg_color}; border-bottom: 1px solid #ddd;">
    <td style="padding: 10px 8px; font-size: 14px; color: #333;">
        {home_display} <span style="color:#888;">vs</span> {away_display}
        <span style="color:#0066cc; font-size: 12px; margin-left: 10px;">{kickoff}</span>
    </td>
    <td style="padding: 10px 8px;"></td>
    <td style="padding: 10px 8px; text-align: center;">
        <div style="color: #00aa00; font-weight: bold;">{hkjc_home}<span style="color: #888; font-size: 11px; margin-left: 3px;">{home_6h}</span></div>
        <div style="color: #17a2b8; font-size: 12px;">{hkjc_home_pct if hkjc_home_pct else '—'}% {poly_home_trend_icon}</div>
    </td>
    <td style="padding: 10px 8px; text-align: center;">
        <div style="color: #ff9900; font-weight: bold;">{hkjc_draw}<span style="color: #888; font-size: 11px; margin-left: 3px;">{draw_6h}</span></div>
        <div style="color: #17a2b8; font-size: 12px;">{hkjc_draw_pct if hkjc_draw_pct else '—'}% {poly_draw_trend_icon}</div>
    </td>
    <td style="padding: 10px 8px; text-align: center;">
        <div style="color: #cc0000; font-weight: bold;">{hkjc_away}<span style="color: #888; font-size: 11px; margin-left: 3px;">{away_6h}</span></div>
        <div style="color: #17a2b8; font-size: 12px;">{hkjc_away_pct if hkjc_away_pct else '—'}% {poly_away_trend_icon}</div>
    </td>
</tr>
"""
    
    html += """</table>

<div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
<h4 style="margin-top: 0;">📖 說明</h4>
<ul style="color: #666; font-size: 13px;">
<li>🟢 <b>馬會赔率</b>：十進制赔率 (如 1.85 = 需投注 HK$1 贏 HK$0.85)</li>
<li>🔵 <b>Polymarket</b>：隱含概率 % (如 55% = 該選項有 55% 機會)</li>
<li>↑/↓ = 對比較時段升/跌</li>
</ul>
</div>

<p style="color: #888; font-size: 12px; margin-top: 20px;">
數據來源：HKJC 馬會 | Polymarket | 更新時間：""" + now_hkt_str + """
</p>
</div>"""
    
    # Post to WordPress
    print("\n📝 更新 WordPress...")
    auth = base64.b64encode(f"{WP_USER}:{WP_APP_PASSWORD}".encode()).decode()
    
    req = requests.post(
        f"https://comparetiger.com/?rest_route=/wp/v2/pages/{WP_PAGE_ID}",
        json={'content': html},
        headers={
            'Authorization': f'Basic {auth}',
            'Content-Type': 'application/json'
        },
        timeout=30
    )
    
    try:
        result = req.json()
        print(f"   WordPress: {result.get('link', 'OK')}")
    except Exception as e:
        print(f"   錯誤: {e}")
    
    # Summary
    unmatched = len(matched_games) - matched_count
    print(f"\n📊 統計：")
    print(f"   馬會賽事: {len(hkjc_games)} 場")
    print(f"   Polymarket: {len(poly_games)} 場")
    print(f"   馬會有赔率: {matched_count} 場")
    print(f"   馬會未開盤: {unmatched} 場 (十六強/八強等球隊未確定)")
    
    print("\n✅ 完成!")

if __name__ == "__main__":
    main()