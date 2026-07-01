#!/usr/bin/env python3
"""
Export HKJC World Cup odds with 1h/4h/24h comparison from NAS JSON files.
Reads odds_YYYY-MM-DD.json files and generates a comparison JSON for the Vercel app.
"""
import json
import sys
import base64
import zlib
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

NAS_PATH = Path("/volume1/flight-scanner/hkjc_data/odds_history")

POLYMARKET_BUILD = "build-TfctsWXpff2fKS"
# That Next.js build hash went stale in June 2026. We now hit Gamma's
# REST API directly for both per-fixture odds and game times.
POLYMARKET_GAMMA_URL = (
    "https://gamma-api.polymarket.com/events"
    "?series_slug=soccer-fifwc&closed=false&active=true&limit=500"
)
# Ancillary slug fragments — drop player-props, exact-score, halftime, etc.
POLYMARKET_ANCILLARY = (
    "player-props", "exact-score", "halftime", "second-half",
    "total-corners", "first-to-score", "more-markets", "spread",
)

# HKJC scraper writes odds files using HKT dates. The NAS runs UTC by default,
# and Python's datetime.now() honors whatever the OS localtime is — which on
# this container ignores the TZ env var (no tzdata package). So we explicitly
# use HKT to match the scraper's file naming and timestamp format.
HKT = timezone(timedelta(hours=8))
def _hkt_now() -> datetime:
    return datetime.now(HKT)

def parse_dt(dt_str):
    # Scraper timestamps are HKT-naive strings; treat them as HKT so we can
    # do tz-aware arithmetic against _hkt_now().
    return datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=HKT)

def nearest_snapshot(target_dt, snapshots):
    """Find snapshot closest to target_dt"""
    best = None
    best_diff = float('inf')
    for snap in snapshots:
        snap_dt = parse_dt(snap["datetime"])
        diff = abs((snap_dt - target_dt).total_seconds())
        if diff < best_diff:
            best_diff = diff
            best = snap
    return best

def normalize_team(name):
    """Normalize team name for matching."""
    return ''.join(c.lower() for c in name if c.isalnum() or c.isspace()).strip()

def fetch_polymarket_games():
    """Fetch game times + 1x2 prices from Polymarket Gamma API.

    Returns a dict keyed by both possible "Home vs Away" and "Away vs Home"
    orders (so callers can match against HKJC's order without caring which
    side of the fixture was listed first).

    Each value is `{'gameTime', 'home', 'away', 'home', 'draw', 'away'}` in
    HKT strings/decimal probability.
    """
    try:
        req = urllib.request.Request(POLYMARKET_GAMMA_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            events = json.loads(resp.read().decode())
    except Exception as e:
        print(f"Polymarket fetch failed: {e}", file=sys.stderr)
        return {}

    game_times = {}
    for ev in events:
        slug = ev.get('slug', '')
        title = ev.get('title', '')
        if not slug.startswith('fifwc-'):
            continue
        if any(x in slug for x in POLYMARKET_ANCILLARY):
            continue
        if ' vs. ' not in title:
            continue

        home, away = title.split(' vs. ', 1)

        # HKT kickoff from `startTime` if present, else `endDate`
        hkt_str = ''
        raw_dt = ev.get('startTime') or ev.get('endDate') or ''
        if raw_dt:
            try:
                dt = datetime.fromisoformat(raw_dt.replace('Z', '+00:00'))
                dt_hkt = dt.astimezone(timezone(timedelta(hours=8)))
                hkt_str = dt_hkt.strftime('%Y-%m-%d %H:%M')
            except Exception:
                pass

        # Three markets: home win / draw / away win
        home_p = draw_p = away_p = None
        for m in ev.get('markets', []):
            q = (m.get('question') or '')
            outcomes = m.get('outcomes', [])
            prices = m.get('outcomePrices', [])
            if isinstance(prices, str):
                try: prices = json.loads(prices)
                except Exception: continue
            if isinstance(outcomes, str):
                try: outcomes = json.loads(outcomes)
                except Exception: continue
            if not outcomes or not prices:
                continue
            try:
                p_yes = float(prices[0])
            except Exception:
                continue
            group = (m.get('groupItemTitle') or '').lower()
            if 'draw' in group:
                draw_p = p_yes
                continue
            q_low = q.lower()
            if home.lower() in q_low and ' win ' in q_low:
                home_p = p_yes
            elif away.lower() in q_low and ' win ' in q_low:
                away_p = p_yes

        info = {
            'gameTime': hkt_str,
            'home': home,
            'away': away,
            'home_odds': home_p,
            'draw_odds': draw_p,
            'away_odds': away_p,
        }
        game_times[f"{home} vs {away}"] = info
        game_times[f"{away} vs {home}"] = info  # reverse-order lookup

    print(f"Fetched {len(game_times)//2} game times from Polymarket", file=sys.stderr)
    return game_times

def build_comparison():
    today = _hkt_now().strftime("%Y-%m-%d")
    yesterday = (_hkt_now() - timedelta(days=1)).strftime("%Y-%m-%d")

    today_file = NAS_PATH / f"odds_{today}.json"
    yesterday_file = NAS_PATH / f"odds_{yesterday}.json"

    today_snaps = []
    if today_file.exists():
        with open(today_file) as f:
            today_snaps = json.load(f)

    # Just after HKT midnight the scraper hasn't written the new day's file yet
    # (next scrape is ~:05 past the hour). Fall back to the most recent file
    # so the page stays populated through the rollover gap.
    if not today_snaps:
        candidates = sorted(NAS_PATH.glob("odds_*.json"), reverse=True)
        if candidates:
            print(f"No {today} file yet, falling back to {candidates[0].name}", file=sys.stderr)
            with open(candidates[0]) as f:
                today_snaps = json.load(f)
            today = candidates[0].stem.replace("odds_", "")
            yesterday = (_hkt_now() - timedelta(days=1)).strftime("%Y-%m-%d")

    yesterday_snaps = []
    if yesterday_file.exists():
        with open(yesterday_file) as f:
            yesterday_snaps = json.load(f)

    # Use HKT for "now" too — the scraper timestamps snapshots in HKT, and
    # the reference deltas (1h/4h/24h) are relative to HKT. If we used UTC,
    # the "nearest snapshot" lookup would drift by 8h.
    now = _hkt_now()

    if not today_snaps:
        print("No today's data!", file=sys.stderr)
        return {"matches": [], "generated": now.isoformat()}

    latest = max(today_snaps, key=lambda s: s["timestamp"])

    # Reference snapshots
    ref_1h = nearest_snapshot(now - timedelta(hours=1), today_snaps)
    ref_4h = nearest_snapshot(now - timedelta(hours=4), today_snaps)
    ref_24h = nearest_snapshot(now - timedelta(hours=24), yesterday_snaps if yesterday_snaps else today_snaps)

    # Fetch game times from Polymarket
    poly_times = fetch_polymarket_games()

    matches = []
    for match_name, odds in latest["odds"].items():
        def calc_change(curr, old):
            if curr is None or old is None: return None
            return round((curr - old) / old * 100, 2) if old != 0 else None

        hkjc_home = odds.get("hkjc_home")
        hkjc_draw = odds.get("hkjc_draw")
        hkjc_away = odds.get("hkjc_away")
        poly_home = odds.get("poly_home")
        poly_draw = odds.get("poly_draw")
        poly_away = odds.get("poly_away")

        # Extract teams from match name
        parts = match_name.split(" vs ")
        home_team = parts[0].strip() if len(parts) >= 2 else match_name
        away_team = parts[1].strip() if len(parts) >= 2 else ""

        # Find game time - try exact match first, then normalized
        game_time_info = poly_times.get(match_name)
        if not game_time_info:
            # Try normalized match
            norm_key = f"{normalize_team(home_team)} vs {normalize_team(away_team)}"
            for pk, pv in poly_times.items():
                pk_norm = f"{normalize_team(pv['home'])} vs {normalize_team(pv['away'])}"
                if pk_norm == norm_key:
                    game_time_info = pv
                    break

        game_time = game_time_info['gameTime'] if game_time_info else ''

        match_data = {
            "match": match_name,
            "homeTeam": home_team,
            "awayTeam": away_team,
            "gameTime": game_time,
            "hkjc": {
                "home": hkjc_home,
                "draw": hkjc_draw,
                "away": hkjc_away,
            },
            "poly": {
                "home": poly_home,
                "draw": poly_draw,
                "away": poly_away,
            },
        }

        # Add comparison for 1h/4h/24h
        if ref_1h:
            old = ref_1h["odds"].get(match_name, {})
            match_data["chg_1h"] = {
                "hkjc_home": calc_change(hkjc_home, old.get("hkjc_home")),
                "hkjc_draw": calc_change(hkjc_draw, old.get("hkjc_draw")),
                "hkjc_away": calc_change(hkjc_away, old.get("hkjc_away")),
                "poly_home": calc_change(poly_home, old.get("poly_home")),
                "poly_draw": calc_change(poly_draw, old.get("poly_draw")),
                "poly_away": calc_change(poly_away, old.get("poly_away")),
            }
        if ref_4h:
            old = ref_4h["odds"].get(match_name, {})
            match_data["chg_4h"] = {
                "hkjc_home": calc_change(hkjc_home, old.get("hkjc_home")),
                "hkjc_draw": calc_change(hkjc_draw, old.get("hkjc_draw")),
                "hkjc_away": calc_change(hkjc_away, old.get("hkjc_away")),
                "poly_home": calc_change(poly_home, old.get("poly_home")),
                "poly_draw": calc_change(poly_draw, old.get("poly_draw")),
                "poly_away": calc_change(poly_away, old.get("poly_away")),
            }
        if ref_24h:
            old = ref_24h["odds"].get(match_name, {})
            match_data["chg_24h"] = {
                "hkjc_home": calc_change(hkjc_home, old.get("hkjc_home")),
                "hkjc_draw": calc_change(hkjc_draw, old.get("hkjc_draw")),
                "hkjc_away": calc_change(hkjc_away, old.get("hkjc_away")),
                "poly_home": calc_change(poly_home, old.get("poly_home")),
                "poly_draw": calc_change(poly_draw, old.get("poly_draw")),
                "poly_away": calc_change(poly_away, old.get("poly_away")),
            }

        matches.append(match_data)

    # Sort by game time
    matches.sort(key=lambda m: m.get("gameTime") or "9999")

    return {
        "matches": matches,
        "generated": now.isoformat(),
        "latest_datetime": latest["datetime"],
        "latest_ts": latest["timestamp"],
        "ref_1h": ref_1h["datetime"] if ref_1h else None,
        "ref_4h": ref_4h["datetime"] if ref_4h else None,
        "ref_24h": ref_24h["datetime"] if ref_24h else None,
    }

if __name__ == "__main__":
    result = build_comparison()
    print(json.dumps(result, ensure_ascii=False, indent=2))
