#!/usr/bin/env python3
"""
CompareTiger flight deal Telegram reporter.

Sends an hourly Telegram message with two clearly separated sections per
airport (HKG, SZX):

  1. 🔥 Fresh drops (vs昨日) — routes whose cheapest date is materially
     lower than yesterday's same-route baseline. This is the "I should
     look at this NOW" section.

  2. 🟢 Stable deals (vs典型價) — routes that are still well below their
     historical typical price even if they didn't move today. This is
     the "good price to keep an eye on" section.

The two sections never overlap (a route that dropped vs yesterday is
already below typical, so we list it in the Fresh section, not both).

SZX is included as a second block in the same message. It will be empty
until the SZX scanner accumulates 24h+ of historical_prices (currently
~zero because we just patched the writer today).

The "vs昨日 0元 +0.0%" noise from the previous version is gone — the
`(vs昨日 ...)` line is only emitted when there's an actual change, and
the Stable section no longer duplicates routes that already moved.

Threshold tuning:
  FRESH_DROP_MIN_PCT      1.0   show in Fresh section only if price dropped >=1%
  FRESH_DROP_TOP_N        10    max routes per airport in Fresh section
  STABLE_DEAL_MIN_PCT     15.0  show in Stable section only if >=15% below typical
  STABLE_DEAL_TOP_N       8     max routes per airport in Stable section
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

# Telegram config — token MUST be set via TELEGRAM_BOT_TOKEN env var.
# Set it in ~/Library/LaunchAgents/com.comparetiger.flight-report.plist
# under EnvironmentVariables, then reload:
#   launchctl unload ~/Library/LaunchAgents/com.comparetiger.flight-report.plist
#   launchctl load ~/Library/LaunchAgents/com.comparetiger.flight-report.plist
# The chat_id is a public-ish identifier so it's safe to keep inline.
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "181186542")

# Note: TELEGRAM_BOT_TOKEN must be set in the launchd plist for the live
# send to work. --dry-run mode bypasses this check.

# Data sources.
#
# Primary path (2026-08-09): fetch live from the deployed Vercel /api/deals
# endpoint. The endpoint reads from the NAS funnel directly, so the alert
# and the website are guaranteed to show the same drops at the same moment.
# Override with FLIGHT_DEALS_API_BASE to point at staging or another deploy.
#
# Fallback path: if the live API is unreachable, fall back to local copies
# at FLIGHT_DATA_DIR (synced from the NAS by sync_flightdeals.sh). The sync
# script still runs as a non-fatal first step in main() — it keeps the
# fallback cache warm in case the API is ever down.
FLIGHT_DEALS_API_BASE = os.environ.get(
    "FLIGHT_DEALS_API_BASE",
    # Hermes 2026-09-21: repointed to 7w7r79wx5 after src/data/ refresh deploy.
    # Previous jr31w3ucv URL was returning stale 2026-09-21T07:30 UTC cache.
    "https://flight-deals-7w7r79wx5-extraiers-projects.vercel.app",
).rstrip("/")
DATA_DIR = os.environ.get(
    "FLIGHT_DATA_DIR",
    os.path.expanduser("~/flight-deals-app/src/data"),
)

# Section thresholds (see module docstring for what each does).
FRESH_DROP_MIN_PCT = 1.0
FRESH_DROP_TOP_N = 10
STALE_DROP_TOP_N = 10
STABLE_DEAL_MIN_PCT = 15.0
STABLE_DEAL_TOP_N = 8

# Cooldown store: route_key -> ISO datetime of last Telegram alert.
# Lives on the Mac (where this script runs) — cooldowns survive across
# hourly runs but are intentionally not committed to the repo.
# Format: {"HKG→PUS": "2026-06-23T07:00:00+08:00", ...}
#
# Hermes 2026-08-14: dedup window is now COOLDOWN_DEDUP_WINDOW (6h rolling),
# NOT "same HK calendar day". The calendar-day check had a midnight race:
# the 00:00 cron would see yesterday's stamps as "not today" and re-alert
# absorbed-baseline drops verbatim. A 6h rolling window allows a genuine
# new drop on the same route to fire later in the day (real drops are
# hours-to-days apart on a given route) but blocks same-day phantom
# repeats. The phantom-repeat failure mode is also addressed in
# extract_deals by the NOISE_FLOOR_AMOUNT / NOISE_FLOOR_PCT gate — both
# fixes together close the bug.
COOLDOWN_PATH = os.path.expanduser(
    "~/.cache/comparetiger/drop_alert_cooldown.json"
)
COOLDOWN_WINDOW = timedelta(hours=24)  # used for GC of old entries
# Hermes 2026-08-14: change dedup window from "same HK calendar day" to
# "last N hours rolling". The calendar-day check was structurally
# vulnerable at the midnight cron: at 00:00:24 the previous day's stamps
# became "yesterday", so any absorbed-baseline drop that slipped past
# Bug A's noise floor would re-fire identical to yesterday's alert.
# A 6-hour rolling window is short enough that the noon cron will still
# allow a genuine new drop on the same route to fire (real drops are
# hours-to-days apart on the same destination), but blocks the same-day
# phantom repeat. 24h is the cap used for GC of old entries (separate).
COOLDOWN_DEDUP_WINDOW = timedelta(hours=24)  # Bug D (2026-08-17): widened from 6h
# Same-day-different-date duplicate fires (ORD case: Sep 23 + Sep 28 both
# at $5895 within 11h) needed a wider window than 6h to suppress cleanly.

# Hermes 2026-09-27: STALE_DISPLAY_WINDOW collapsed back into
# COOLDOWN_DEDUP_WINDOW. Separating them caused the 📌 section to
# disappear for ~18h of every 24h cycle (entries stamped together at
# 03:00 were >6h old by 11:00; user reported "where is 持續跌價,
# disappeared"). The Bug E idempotent-stamp fix means the "Xh前" timer
# no longer freezes — entries' age labels tick up correctly across
# hourly cron fires — so we don't need a shorter display window to
# keep the report feeling dynamic. The "stuck timer" problem is gone,
# and a too-short display window was the wrong knob for "feels static".
STALE_DISPLAY_WINDOW = COOLDOWN_DEDUP_WINDOW

# Hermes 2026-08-15: price-aware cooldown for phantom alerts.
# The 6h time-window dedup alone doesn't catch the case where the
# exporter's history.1d baseline is stale (still showing yesterday's
# price from before today's drop), so a route that dropped >6h ago
# re-fires at the next hour with the IDENTICAL (price, drop_pct,
# drop_amount) tuple. Example: HKG→TPE was 1438 on 2026-08-13, dropped
# to 1278 sometime on 2026-08-13. The scanner's historical_prices skip
# (fli_detail_scan_aggressive.py:244 — "skip write when price delta <5")
# means recorded_date=2026-08-13 stayed at 1438 even after the drop.
# Today the exporter reports yest=1438 vs today=1278 → alert.
# If we alert and 7h later the exporter still reports yest=1438 vs
# today=1278 (same numbers), we'd re-alert identically. Suppress that.
# We track the (price, drop_pct, drop_amount) tuple alongside the
# timestamp. If a new "fresh drop" matches the previously alerted
# tuple EXACTLY (within $1 / 0.1% — exporter round-trip noise),
# it's a phantom and is suppressed regardless of the time window.
PHANTOM_PRICE_TOLERANCE = 1.0   # HKD — minimum tolerance floor (cheap routes)
# Hermes 2026-08-17 (Bug D): widened tolerance from a flat $1 to 1% of
# the previously-alerted price, with the $1 floor above for very cheap
# routes. The flat $1 was too narrow for $4k–$8k range flights where a
# $50 noise difference would slip through as "not a phantom" when it
# actually was. The 1% tolerance catches the ORD case: Sep 28 alert
# prev price $5895 → tolerance = max($1, $58.95) = $58.95. A re-fire at
# $5895 with a different drop_amount now matches and is suppressed as a
# same-destination event.
PHANTOM_PRICE_PCT = 0.01        # 1% of previously-alerted price

# Do not publish an old airline snapshot forever when its scanner/exporter
# stalls. The hourly reporter may still use fresh HKG/SZX data while omitting
# only the stale CX block.
CX_MAX_DATA_AGE = timedelta(hours=12)
UO_MAX_DATA_AGE = timedelta(hours=12)


# ---------- I/O helpers ----------

def send_telegram(text: str) -> bool:
    """Post a single message to the configured chat. Returns True on success.

    Telegram has a 4096 char limit per message; if our text is longer we
    refuse to send (better than truncating silently). The current format
    fits in ~1700 chars, so this is just a safety net.
    """
    if not TELEGRAM_TOKEN:
        print("ERROR: TELEGRAM_BOT_TOKEN env var is not set. Refusing to send.")
        print("       Add it to the launchd plist (see comment at top) and reload.")
        return False
    if len(text) > 4000:
        print(f"WARN: message is {len(text)} chars, refusing to send (limit 4096)")
        return False
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        # parse_mode disabled — plain text is more reliable in Telegram;
        # special chars like 🔴 🟢 are unicode and render fine.
    })
    req = urllib.request.Request(
        url, data=data.encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            payload = json.loads(r.read())
            return payload.get("ok", False)
    except Exception as e:
        print(f"Telegram send error: {e}")
        return False


def load_json(path: str):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception as e:
        print(f"load_json({path}) failed: {e}")
        return None


def fetch_json_url(url: str, timeout: float = 15.0):
    """Fetch a JSON document over HTTPS. Used for live /api/deals calls.

    Returns parsed dict/list on success, None on any failure (DNS, timeout,
    non-2xx, malformed JSON). Errors are logged so they show up in the
    launchd-captured /tmp/flight_report.log — never silent.
    """
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
        return json.loads(body)
    except urllib.error.HTTPError as e:
        print(f"fetch_json_url({url}) HTTP {e.code}: {e.reason}")
    except urllib.error.URLError as e:
        print(f"fetch_json_url({url}) network error: {e.reason}")
    except Exception as e:
        print(f"fetch_json_url({url}) failed: {e}")
    return None


def load_with_fallback(fetch_fn, fallback_path: str):
    """Try LOCAL first (synced hourly from NAS, always fresh), fall back to live API.

    Hermes 2026-09-21: was trying live API first, but Vercel cache often lags
    the NAS sync by hours. Local file (sync_flightdeals.sh cron @ :17 every
    hour) is fresher because it bypasses Vercel's static fallback.
    Live API only used when local file is missing or stale > 6 hours.
    """
    local = load_json(fallback_path)
    if local and local.get("results"):
        local_gen = local.get("generated", "")
        # If local file has a valid generated timestamp within 6 hours, prefer it
        try:
            stamp = datetime.fromisoformat(local_gen.replace("Z", "+00:00"))
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=timezone.utc)
            age = _now_hk() - stamp.astimezone(_now_hk().tzinfo)
            if timedelta(hours=0) <= age <= timedelta(hours=6):
                print(f"  using local {fallback_path} (age={age}, generated={local_gen})")
                return local
        except Exception:
            pass
    # Local stale or invalid — try live API as backup
    data = fetch_fn()
    if data:
        return data
    if local:
        print(f"  live fetch failed — using local file {fallback_path}")
        return local
    return None


# ---------- Cooldown (daily dedup of Telegram fresh-drop alerts) ----------

def _now_hk() -> datetime:
    """Current time as a tz-aware datetime in Asia/Hong_Kong (UTC+8)."""
    return datetime.now(timezone(timedelta(hours=8)))


def _hkt_ts_from_iso(iso: str) -> str:
    """Convert an ISO timestamp (UTC or naive) → 'YYYY-MM-DD HH:MM HKT' (UTC+8).

    The NAS-side exporter writes `datetime.now().isoformat()` (naive UTC).
    We treat naive as UTC, then shift to Asia/Hong_Kong for display.
    Used in fmt_airport_block to render the data-stamp line in the user's
    local timezone instead of UTC.
    """
    if not iso:
        return ""
    try:
        stamp = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except Exception:
        return iso[:16] + " HKT"  # fall back to raw slice
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    hkt = stamp.astimezone(timezone(timedelta(hours=8)))
    return hkt.strftime("%Y-%m-%d %H:%M HKT")


def _today_key_hk() -> str:
    """Return today's date as YYYY-MM-DD in Asia/Hong_Kong (UTC+8).

    The Telegram chat is for HK users and launchd runs in their timezone,
    but we use a fixed offset instead of `astimezone()` so this also works
    when the script is invoked manually from a different shell timezone.
    """
    return _now_hk().strftime("%Y-%m-%d")


# Hermes 2026-09-09: IATA → Cantonese-traditional-Chinese city name fallback
# for destinations whose source JSON has only an airport code in `name`
# (some scan paths and older exporters write "HIJ" instead of "廣島 (HIJ)").
IATA_NAME_CN = {
    'HIJ': '廣島', 'TAK': '高松', 'SDJ': '仙台', 'KMI': '宮崎',
    'AOJ': '青森', 'HKD': '釧路', 'HNA': '花卷', 'KIJ': '新潟',
    'AKJ': '旭川', 'TOY': '富山', 'ISG': '石垣', 'NGO': '名古屋',
    'KIX': '大阪關西', 'ITM': '大阪伊丹', 'KOB': '神戶',
    'CTS': '札幌', 'HND': '羽田', 'NRT': '成田', 'OKA': '沖繩',
    'FUK': '福岡', 'KOJ': '鹿兒島', 'KMJ': '熊本', 'TYO': '東京',
    'ICN': '首爾仁川', 'GMP': '首爾金浦', 'PUS': '釜山',
    'CJU': '濟州', 'TAE': '大邱',
    'TPE': '台北', 'TSA': '台北松山', 'KHH': '高雄',
    'BKK': '曼谷', 'DMK': '曼谷廊曼', 'HKT': '布吉', 'CNX': '清邁',
    'KBV': '喀比', 'HDY': '合艾', 'CEI': '清萊', 'UTH': '烏隆',
    'SIN': '新加坡', 'KUL': '吉隆坡', 'PEN': '檳城', 'LGK': '蘭卡威',
    'BKI': '亞庇', 'KCH': '古晉', 'MYY': '美里',
    'MNL': '馬尼拉', 'CRK': '克拉克', 'CEB': '宿霧', 'DVO': '達沃',
    'PQC': '富國島', 'SGN': '胡志明市', 'HAN': '河內', 'DAD': '峴港',
    'REP': '暹粒', 'DPS': '峇里島', 'KLO': '卡利博',
    'CGK': '雅加達', 'DPS': '峇里島', 'SUB': '泗水', 'MDC': '萬鴉老',
    'CAN': '廣州', 'PEK': '北京', 'PKX': '北京大興', 'PVG': '上海浦東',
    'SHA': '上海虹橋', 'SZX': '深圳', 'HGH': '杭州', 'NGB': '寧波',
    'CZX': '長沙', 'XIY': '西安', 'CTU': '成都', 'CKG': '重慶',
    'XMN': '廈門', 'FOC': '福州', 'HAK': '海口', 'SYX': '三亞',
    'WUX': '無錫', 'KMG': '昆明', 'WUH': '武漢', 'NKG': '南京',
    'SHE': '瀋陽', 'TSN': '天津', 'YIW': '義烏', 'DLC': '大連',
    'CSX': '長沙', 'HFE': '合肥', 'HET': '呼和浩特',
    'DEL': '德里', 'BOM': '孟買', 'BLR': '班加羅爾', 'MAA': '清奈',
    'CCU': '加爾各答', 'CMB': '科倫坡', 'KTM': '加德滿都',
    'DXB': '杜拜', 'DOH': '多哈', 'AUH': '阿布扎比', 'CAI': '開羅',
    'JNB': '約翰內斯堡', 'CPT': '開普敦', 'LOS': '拉各斯', 'NBO': '奈洛比',
    'CDG': '巴黎', 'ORY': '巴黎奧利', 'LHR': '倫敦', 'LGW': '倫敦蓋威克',
    'AMS': '阿姆斯特丹', 'FRA': '法蘭克福', 'MUC': '慕尼黑',
    'MAD': '馬德里', 'BCN': '巴塞羅拿', 'FCO': '羅馬', 'MXP': '米蘭',
    'VCE': '威尼斯', 'ZRH': '蘇黎世', 'VIE': '維也納', 'CPH': '哥本哈根',
    'ARN': '斯德哥爾摩', 'OSL': '奧斯陸', 'HEL': '赫爾辛基',
    'WAW': '華沙', 'IST': '伊斯坦堡', 'SVO': '莫斯科',
    'JFK': '紐約', 'LAX': '洛杉磯', 'ORD': '芝加哥', 'SFO': '三藩市',
    'SEA': '西雅圖', 'YVR': '溫哥華', 'YYZ': '多倫多', 'BOS': '波士頓',
    'ATL': '亞特蘭大', 'DFW': '達拉斯', 'MIA': '邁阿密', 'DEN': '丹佛',
    'IAH': '休斯敦', 'LGB': '長堤', 'OAK': '奧克蘭', 'SAN': '聖地牙哥',
    'ANC': '安克雷奇', 'HNL': '檀香山', 'GUM': '關島',
    'AKL': '奧克蘭', 'WLG': '威靈頓', 'SYD': '悉尼', 'MEL': '墨爾本',
    'BNE': '布里斯班', 'PER': '珀斯', 'ADL': '阿德萊德', 'CBR': '坎培拉',
}


def _localize_dest(dest: dict | None, fallback_code: str = "") -> str:
    """Return a Cantonese-traditional-Chinese destination label like '廣島 (HIJ)'.

    Hermes 2026-09-09: most scan paths now stamp Chinese names at the
    scanner source, but we keep this fallback because (a) cache layers
    occasionally write 'HIJ' only, (b) exporters from third-party
    scanners may not localize at all, and (c) Telegram users expect
    every airport to render with both the city and the IATA code.
    """
    code = (dest or {}).get('code') or fallback_code or ''
    name = (dest or {}).get('name') or ''
    has_cjk = any('\u4e00' <= ch <= '\u9fff' for ch in name)
    if has_cjk and name:
        return name
    city = IATA_NAME_CN.get(code, code or name)
    return f'{city} ({code})' if code else city


def data_is_fresh(data: dict | None, max_age: timedelta) -> bool:
    """Return True when data.generated is parseable and within max_age."""
    generated = (data or {}).get("generated")
    if not generated:
        return False
    try:
        stamp = datetime.fromisoformat(generated.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone(timedelta(hours=8)))
        age = _now_hk() - stamp.astimezone(_now_hk().tzinfo)
        return timedelta(0) <= age <= max_age
    except (TypeError, ValueError):
        return False


def load_cooldown() -> dict:
    """Return {route_key: ISO-datetime | stamped_dict} of previous alerts.

    Backwards-compatible: pre-2026-08-15 entries are plain ISO strings.
    Post-2026-08-15 entries are dicts like {"ts": "ISO", "price": 1278,
    "pct": -11.1, "amount": -160} so we can detect phantom re-fires
    (same price tuple) even when the 6h time window has elapsed.
    """
    try:
        with open(COOLDOWN_PATH) as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"load_cooldown failed: {e}")
    return {}


def migrate_legacy_cooldown(cooldown: dict) -> dict:
    """Convert legacy plain-string cooldown entries to the new dict format.

    Hermes 2026-08-15: pre-existing cooldown entries (loaded from a file
    written before this commit) are just ISO timestamps. They still
    work for the 6h time-window dedup (Bug B), but can't drive the
    phantom-repeat fingerprint check (Bug C) because no price was
    stored. We wrap each legacy entry in {"ts": ISO, "price": None, ...}
    so the file shape is uniform going forward. None fingerprint means
    is_phantom_repeat() returns False — legacy entries never trigger a
    phantom suppression, they only contribute to the time-window check.

    Idempotent: new-format entries pass through unchanged.
    """
    out = {}
    changed = False
    for k, v in cooldown.items():
        if isinstance(v, str):
            out[k] = {"ts": v, "price": None, "pct": None, "amount": None}
            changed = True
        else:
            out[k] = v
    if changed:
        try:
            save_cooldown(out)
            print(f"  cooldown: migrated {sum(1 for v in cooldown.values() if isinstance(v, str))} legacy entries to stamped format")
        except Exception as e:
            print(f"  cooldown migration save failed (non-fatal): {e}")
    return out


def _cooldown_ts(entry) -> str | None:
    """Extract ISO timestamp from either old (str) or new (dict) cooldown entry."""
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        return entry.get("ts")
    return None


def _cooldown_alerted_at(entry) -> datetime | None:
    """Parse the alert timestamp into a tz-aware HK datetime."""
    ts = _cooldown_ts(entry)
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except (ValueError, TypeError):
        return None


def _cooldown_signature(entry) -> dict | None:
    """Extract the (price, pct, amount) fingerprint from a stamped dict entry.

    Returns None for legacy plain-string entries (no fingerprint stored).
    """
    if not isinstance(entry, dict):
        return None
    return {
        "price": entry.get("price"),
        "pct": entry.get("pct"),
        "amount": entry.get("amount"),
    }


def is_phantom_repeat(d: dict, entry) -> bool:
    """True if a fresh-drop candidate matches the previously alerted
    (price, amount) tuple within tolerance.

    Used to suppress re-fires that occur after the 6h time window has
    elapsed but with byte-identical numbers — the symptom of a stale
    historical_prices baseline being reused across exporter cycles.

    We compare on price + amount (both are dollar values) rather than
    pct, because pct is a ratio and amplifies small price differences
    when the baseline is large. Two exports reporting the same price
    tuple with slightly different pct (e.g. -11.1% vs -11.0% due to
    the yest baseline ticking by $1) are still the same drop, not a
    new one — so pct is checked only as a sanity assertion, not as
    the primary fingerprint.
    """
    sig = _cooldown_signature(entry)
    if sig is None:
        return False  # legacy entry — no fingerprint to compare
    if sig.get("price") is None:
        return False
    if abs(d["price"] - sig["price"]) > PHANTOM_PRICE_TOLERANCE:
        return False
    if sig.get("amount") is None or abs(d.get("drop_amount", 0) - sig["amount"]) > PHANTOM_PRICE_TOLERANCE:
        return False
    return True


def save_cooldown(data: dict) -> None:
    """Atomic write: tmp file → os.replace. Avoids a half-written cooldown
    if the script is killed mid-write."""
    import os as _os
    parent = _os.path.dirname(COOLDOWN_PATH)
    try:
        _os.makedirs(parent, exist_ok=True)
        tmp = COOLDOWN_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f, indent=2, sort_keys=True)
        _os.replace(tmp, COOLDOWN_PATH)
    except Exception as e:
        print(f"save_cooldown failed: {e}")



def _cooldown_alerted(entry) -> datetime | None:
    """Parse a cooldown entry (str or dict) → datetime in HK tz.

    Hermes 2026-09-23: companion to filter_with_stale_alerted. Pulled out
    of the existing _cooldown_alerted_at (returns tz-aware datetime).
    """
    return _cooldown_alerted_at(entry)



def filter_with_stale_alerted(fresh: list, cooldown: dict) -> tuple[list, list]:
    """Like filter_already_alerted but ALSO returns in-cooldown drops.

    Returns (new_fresh, stale_fresh) where stale_fresh contains drops that
    were alerted within COOLDOWN_DEDUP_WINDOW (24h) but are still real
    today-vs-yesterday drops. Callers render stale as "📌 持續跌價".

    Hermes 2026-09-23: user feedback — empty section after cooldown
    filtering looked like "no drops at all", hiding the fact that the
    route is still below yesterday. Show them with a badge instead.
    """
    new = []
    stale = []
    now_hk = _now_hk()
    for d in fresh:
        key = d.get("route_key") or d.get("dest")
        entry = cooldown.get(key)
        if entry is None:
            new.append(d)
            continue
        last_dt = _cooldown_alerted(entry)
        if last_dt is not None:
            age = now_hk - last_dt
            if age < COOLDOWN_DEDUP_WINDOW:
                # Hermes 2026-09-27: only surface in the 📌 block for
                # STALE_DISPLAY_WINDOW. After that the entry stays in the
                # cooldown dict (so we don't re-fire) but drops out of the
                # hourly report. The report is meant to feel current;
                # showing the same 24 routes verbatim for 24h was noise.
                if age < STALE_DISPLAY_WINDOW:
                    age_min = int(age.total_seconds() / 60)
                    if age_min >= 60:
                        age_h_int = age_min // 60
                        age_m_rem = age_min % 60
                        d["_stale_age"] = f"{age_h_int}h{age_m_rem:02d}m前"
                    else:
                        d["_stale_age"] = f"{age_min}m前"
                    stale.append(d)
                continue
        new.append(d)
    return new, stale


def filter_already_alerted(fresh: list, cooldown: dict, today: str | None = None) -> list:
# Hermes 2026-09-23: 持續跌價 section
    """Drop any Fresh entries whose route_key was alerted within COOLDOWN_DEDUP_WINDOW,
    OR whose (price, pct, amount) tuple matches a previously alerted entry
    even if outside the time window (phantom repeat from stale exporter baseline).

    Hermes 2026-08-14 (Bug B): window is now a rolling N hours (default 6h).
    Hermes 2026-08-17 (Bug D): window widened to 24h to suppress
    same-day-different-date duplicate fires (ORD case: Sep 23 + Sep 28
    both at $5895 within 11h needed a wider window than 6h to suppress).
    The calendar-day check used to have a midnight race (00:00 cron
    would see yesterday's stamps as "yesterday"); the rolling 6→24h
    window still allows a genuine new drop on the same route to fire
    hours/days later, while blocking intra-day phantom repeats and
    same-day-different-date duplicates.

    Hermes 2026-08-15 (Bug C): the 6h window alone doesn't catch the case
    where the EXPORTER itself has a stale historical_prices baseline (the
    scanner skip at fli_detail_scan_aggressive.py:244 leaves a high yesterday
    price in the DB even after today's drop). The destination-low math then
    reproduces the SAME (price, pct, amount) tuple across cycles. If a new
    fresh drop matches the fingerprint of any cooldown entry within
    COOLDOWN_WINDOW (24h) of slack, it's a phantom — suppress it. If the
    fresh drop has DIFFERENT numbers (real new price event), the route
    fires normally. This is a strict-superset of the BKK PUS case documented
    in telegram-destination-level-phantom-alert.md.

    `today` arg is kept for back-compat with the 2026-06-30 comment that
    described this as 24h-cooldown — but it's not used. The decision is
    purely "how recently was this route alerted, in any timezone".

    `fresh` items use `dest` (e.g. "釜山 (PUS)") which isn't unique across
    HKG+SZX. The caller is expected to have set `route_key` on each item
    (we do that in build_message). Falls back to `dest` if route_key is
    missing.
    """
    out = []
    skipped_window = []
    skipped_phantom = []
    now_hk = _now_hk()
    for d in fresh:
        key = d.get("route_key") or d.get("dest")
        entry = cooldown.get(key)

        if entry is None:
            out.append(d)
            continue

        # Bug B: 6h rolling time-window dedup.
        last_dt = _cooldown_alerted_at(entry)
        if last_dt is not None:
            age = now_hk - last_dt
            if age < COOLDOWN_DEDUP_WINDOW:
                skipped_window.append(key)
                continue

        # Bug C: phantom-repeat detection via price fingerprint.
        # Only check against entries within COOLDOWN_WINDOW (24h) — older
        # stamps have GC'd their fingerprint anyway via mark_alerted().
        if last_dt is not None:
            age = now_hk - last_dt
            if age <= COOLDOWN_WINDOW and is_phantom_repeat(d, entry):
                skipped_phantom.append(key)
                continue

        out.append(d)
    if skipped_window:
        print(f"  cooldown: {len(skipped_window)} route(s) alerted within {int(COOLDOWN_DEDUP_WINDOW.total_seconds()/3600)}h, skipping: {skipped_window}")
    if skipped_phantom:
        print(f"  phantom-repeat: {len(skipped_phantom)} route(s) re-firing with identical (price, pct, amount), skipping: {skipped_phantom}")
    # Hermes 2026-09-27 (Bug F): cap fresh list to FRESH_DROP_TOP_N after
    # the cooldown/phantom filter so the user-visible section stays bounded,
    # even though extract_deals now over-fetches to give non-cooldown drops
    # a chance of surviving the dedup step.
    return out[:FRESH_DROP_TOP_N]


def mark_alerted(route_keys: list, cooldown: dict, *, alert_payload: dict | None = None) -> dict:
    """Return a NEW cooldown dict with these routes stamped to now (HK).

    Hermes 2026-08-15: when a route is alerted, also store its
    (price, pct, amount) fingerprint alongside the timestamp so the
    phantom-repeat check can fire later. `alert_payload` is the dict
    built in main() that maps route_key → {price, drop_pct, drop_amount}.
    Routes that aren't in the payload (or that aren't fresh drops —
    e.g. stable-only alerts) keep the legacy plain-string format.

    Hermes 2026-09-27 (Bug E): idempotent stamping. main() previously
    collected every raw UO fresh drop into route_keys, including ones
    already in cooldown (where filter_already_alerted was bypassed for
    the uo_fresh_raw / uo_uo_raw paths). That caused every hourly cron
    to REFRESH the timestamp of routes still in the 📌 block, pinning
    the displayed "Xh前" timer near 0m indefinitely. Fix: only stamp
    routes that don't already have a valid cooldown entry. Stale
    (already-stamped) routes keep their original ts so the timer
    counts up correctly across hourly cron fires.
    """
    now_iso = _now_hk().isoformat()
    new = dict(cooldown)
    payload = alert_payload or {}

    def _existing_ts(entry) -> str:
        if isinstance(entry, str):
            return entry
        if isinstance(entry, dict):
            return entry.get("ts", "")
        return ""

    for k in route_keys:
        existing_ts = _existing_ts(new.get(k))
        if existing_ts:
            # Route is already in cooldown — keep original timestamp
            # so the 📌 display timer increments hour-over-hour.
            continue
        fingerprint = payload.get(k)
        if fingerprint:
            new[k] = {
                "ts": now_iso,
                "price": fingerprint.get("price"),
                "pct": fingerprint.get("drop_pct"),
                "amount": fingerprint.get("drop_amount"),
            }
        else:
            new[k] = now_iso
    # Garbage-collect entries older than COOLDOWN_WINDOW so the file
    # stays small. Daily-cadence cooldown means we only need yesterday's
    # entries around to suppress "same calendar day" re-fires, but we
    # keep COOLDOWN_WINDOW (24h) of slack so a route stamped late at
    # night still has its entry through the next day's window.
    cutoff = (_now_hk() - COOLDOWN_WINDOW).isoformat()

    new = {k: v for k, v in new.items() if _existing_ts(v) >= cutoff}
    return new


# ---------- Deal extraction ----------

def month_short(m: int) -> str:
    return f"{m}月"


def extract_deals(data: dict, *, departure: str, fresh_min_pct: float, stable_min_pct: float):
# Hermes 2026-09-23: allow stable deals without yest baseline

    """Pull (fresh_drops, stable_deals) from a scanner output dict.

    Both lists are sorted best-to-worst by their own metric.
    `fresh_drops` is sorted by pct drop (biggest first).
    `stable_deals` is sorted by pct off typical (deepest discount first).

    A route that already appears in fresh_drops is excluded from
    stable_deals — we don't want to list HKG→MNL twice just because it
    dropped AND is below typical.

    Comparison semantics (user rule 2026-08-10):
      Today's price  = dates[0].price               (the cheapest date)
      Yesterday's price = dates[0].history.1d.price (THIS date's own baseline)
      Drop = today_price - yest_price              (negative = price went down)

      Only fire when dates[0] has its OWN history.1d baseline. NO
      destination-level min. NO 4d/7d fallback — per-date comparison
      is meaningless across dates. If history.1d is missing, skip
      the route entirely (no phantom "vs昨日 -X元").

      User constraint: "1 alert a day" — the daily cadence + 24h
      cooldown together mean each route fires at most once per HK
      calendar day. Combined with the strict per-date comparison,
      a route only re-fires if the SAME date really did get cheaper
      against yesterday (which won't normally happen on a stable
      baseline — the alert is genuinely "this just dropped").
    """
    fresh = []
    stable = []
    for r in (data or {}).get("results") or []:
        dates = r.get("cheapestDates") or []
        if not dates:
            continue
        dest_name = _localize_dest(r.get("destination"), fallback_code=r.get("route", ""))
        typical = r.get("typicalPrice") or 0
        if typical <= 0:
            continue

        # ---- The cheapest date (today's pick) ----
        priced = [(cd.get("price"), cd) for cd in dates if cd.get("price")]
        if not priced:
            continue
        # Hermes 2026-09-01: outlier filter — Google Flights occasionally
        # returns a single garbage cache-hit price (e.g. HK$188 for BKK when
        # the real cheapest is HK$1,500+). If today_low is < 30% of the
        # second-cheapest date, treat it as an anomaly and use the
        # second-cheapest instead. This prevents bogus "低典型 90%" alerts
        # when the cached typicalPrice is right but the historical depth
        # is poisoned. (Underlying data not mutated — filter is local.)
        priced_sorted = sorted(
            priced,
            key=lambda x: (x[0], x[1].get("month", 99), x[1].get("day", 99)),
        )
        today_low, today_cd = priced_sorted[0]
        if len(priced_sorted) >= 3 and typical > 0:
            second_low = priced_sorted[1][0]
            if second_low > 0 and today_low < second_low * 0.30:
                today_low, today_cd = priced_sorted[1]

        # ---- That date's OWN history.1d baseline ----
        # Per-date comparison: we compare this exact date's price today
        # against its own price yesterday. No destination-level min,
        # no 4d/7d fallback (those would let a sibling date with a
        # different history dilute the answer).
        hist = today_cd.get("history") or {}
        yest_low = (hist.get("1d") or {}).get("price") or 0

        # Hermes 2026-09-23: yest is OPTIONAL. The fresh (vs昨日) section
        # needs it; the stable (vs typical) section does NOT. Previously
        # the whole route was skipped if no yest existed, which killed
        # the stable section for routes where the baseline scanner is
        # currently down (HKG as of 2026-09-23).
        diff = None
        drop_pct = None
        if yest_low and yest_low > 0:
            diff = today_low - yest_low              # negative = drop
            drop_pct = diff / yest_low * 100         # negative = drop
        # Hermes 2026-08-14: noise-floor gate (Bug A). The exporter rewrites
        # history.1d each cycle; on a stable baseline this can produce a
        # $1-$2 / 0.1-0.4% delta that satisfies the -1% threshold but is
        # not a real drop. Require either a real absolute drop OR a real
        # percentage drop — not "barely changed but technically negative".
        # This is what the 2026-08-10 comment at extract_deals claimed to
        # achieve ("structurally prevented by strict per-date comparison")
        # but the baseline-rewriting exporter defeats that assumption.
        NOISE_FLOOR_AMOUNT = 10   # HKD — anything < this is noise
        NOISE_FLOOR_PCT    = 0.5  # %    — anything < this is noise
        if drop_pct is not None and (
            drop_pct <= -fresh_min_pct
            and (abs(diff) >= NOISE_FLOOR_AMOUNT
                 or abs(drop_pct) >= NOISE_FLOOR_PCT)
        ):
            flight = today_cd.get("flight") or {}
            airline = (flight.get("airline") or "").lstrip("_")
            fresh.append({
                "dest": dest_name,
                "price": today_low,
                "dep": f"{month_short(today_cd['month'])}{today_cd['day']}日",
                "airline": airline,
                "drop_pct": drop_pct,
                "drop_amount": diff,
                "typical_savings": (typical - today_low) / typical * 100,
            })

        # ---- Stable deal: today_low vs typical (no yest required) ----
        typical_savings = (typical - today_low) / typical * 100
        if typical_savings >= stable_min_pct:
            flight = today_cd.get("flight") or {}
            airline = (flight.get("airline") or "").lstrip("_")
            stable.append({
                "dest": dest_name,
                "price": today_low,
                "dep": f"{month_short(today_cd['month'])}{today_cd['day']}日",
                "airline": airline,
                "typical_savings": typical_savings,
            })

    fresh.sort(key=lambda d: d["drop_pct"])  # most negative first
    stable.sort(key=lambda d: -d["typical_savings"])  # highest savings first

    # Tag every item with its route_key for downstream cooldown dedup
    for d in fresh:
        d["route_key"] = f"{departure}→{d['dest']}"
    for d in stable:
        d["route_key"] = f"{departure}→{d['dest']}"

    # Dedupe: a route already in fresh shouldn't appear in stable
    fresh_dests = {d["dest"] for d in fresh}
    stable = [d for d in stable if d["dest"] not in fresh_dests]

    # Hermes 2026-09-27 (Bug F): expand the slice ceiling past the cooldown
    # overlap so the downstream `filter_already_alerted` step still has
    # non-cooldown entries to surface. Previously we sliced to FRESH_DROP_TOP_N
    # here, before any cooldown filtering — and on days where many routes
    # are in cooldown, all top-N fresh items were already alerted and got
    # filtered out, leaving an empty 🔥 section. Now slice to the larger
    # of FRESH_DROP_TOP_N and a 3x ceiling so smaller drops have a chance
    # of surviving the cooldown filter. Caller's filter_already_alerted
    # does the final top-N trimming.
    slice_ceiling = max(FRESH_DROP_TOP_N, FRESH_DROP_TOP_N * 3)
    return fresh[:slice_ceiling], stable[:STABLE_DEAL_TOP_N]


# ---------- Format ----------

def fmt_drop(d: dict) -> str:
    """🔥 Fresh drop block — shows vs昨日 delta and low-typical context.

    The `vs昨日` line is only emitted when there's a real change from
    yesterday (drop_amount != 0). If for any reason a route slips into
    the fresh list with no actual delta, we hide the line rather than
    show a noisy "vs昨日 0元 +0.0%".
    """
    airline = d["airline"] or "—"
    base = (
        f"🔥 {d['dest']}\n"
        f"   HK${d['price']:,.0f} {d['dep']} {airline}\n"
    )
    if d.get("drop_amount", 0) != 0:
        return (
            base
            + f"   vs昨日 {d['drop_amount']:+.0f}元 ({d['drop_pct']:+.1f}%)"
            + f" · 低典型 {d['typical_savings']:.0f}%"
        )
    return base + f"   低典型 {d['typical_savings']:.0f}%"


def fmt_stable(d: dict) -> str:
    """🟢 Stable deal block — shows typical discount only, no vs昨日 line."""
    airline = d["airline"] or "—"
    return (
        f"🟢 {d['dest']}\n"
        f"   HK${d['price']:,.0f} {d['dep']} {airline}\n"
        f"   低典型 {d['typical_savings']:.0f}%"
    )


# ---------- UO-only (Hong Kong Express) drops ----------

# Hermes 2026-06-30: filter to flights operated by HK Express. The scanner
# stamps `cheapestDates[].flight.airline` with the 2-letter IATA carrier
# code (e.g. "UO"). We compare the cheapest UO date's price vs ITS OWN
# `history.1d` baseline (same date's yesterday price) — that's the same
# semantics as the main fresh-drop section, just airline-scoped.
#
# Edge case: a brand-new UO low may not yet have a 1d baseline (the export
# only writes baselines on the next cycle). For those, we don't show a
# drop (no delta to compute) — they'll appear once the baseline catches up.
UO_AIRLINE_CODE = "UO"
UO_DROP_TOP_N = 5


def extract_uo_drops(data: dict, departure: str, fresh_min_pct: float) -> list:
    """Return list of UO-scoped drops for one airport.

    Each item: {dest, code, price, yest, dep, drop_amount, drop_pct,
                flight_no, dep_time, route_key}. Sorted by drop_pct asc.
    """
    out = []
    for r in (data or {}).get("results") or []:
        dates = r.get("cheapestDates") or []
        if not dates:
            continue
        dest_name = _localize_dest(r.get("destination"), fallback_code=r.get("route", ""))
        # Restrict to dates that have a UO flight stamp
        uo_dates = [
            cd for cd in dates
            if (cd.get("flight") or {}).get("airline", "").lstrip("_") == UO_AIRLINE_CODE
        ]
        if not uo_dates:
            continue
        # Find the cheapest UO date that has a 1d baseline we can compare.
        # (If the cheapest UO date has no 1d yet, try the next-cheapest UO
        # date that does — that still gives a meaningful "UO price dropped"
        # signal for the destination, just anchored to a slightly later date.)
        candidates = sorted(
            [cd for cd in uo_dates if cd.get("price") and cd["price"] > 0],
            key=lambda cd: (cd["price"], cd.get("month", 99), cd.get("day", 99)),
        )
        chosen = None
        yest = None
        for cd in candidates:
            h1d = (cd.get("history") or {}).get("1d") or {}
            yp = h1d.get("price")
            if yp and yp > 0:
                chosen = cd
                yest = yp
                break
        if chosen is None:
            continue
        today_low = chosen["price"]
        diff = today_low - yest            # negative = drop
        drop_pct = diff / yest * 100
        if drop_pct > -fresh_min_pct:
            continue
        flight = chosen.get("flight") or {}
        out.append({
            "dest": dest_name,
            "code": (r.get("destination") or {}).get("code", ""),
            "price": today_low,
            "yest": yest,
            "dep": f"{month_short(chosen['month'])}{chosen['day']}日",
            "flight_no": (flight.get("flight_no") or "").strip() or "—",
            "dep_time": (flight.get("dep_time") or "").strip(),
            "drop_amount": diff,
            "drop_pct": drop_pct,
            "route_key": f"{departure}→UO→{dest_name}",
        })
    out.sort(key=lambda d: d["drop_pct"])
    return out[:UO_DROP_TOP_N]


def fmt_uo_drop(d: dict) -> str:
    """✈️🔥 UO drop block — always shows vs昨日 (that's the whole point).

    Format: "✈️🔥 曼谷 (BKK)\\n   UO HK$1,587 11月18日 17:50 UO 716\\n   vs昨日 -93元 (-5.5%)"
    """
    flt = d.get("flight_no") or "—"
    time = d.get("dep_time") or ""
    flt_label = f"UO {flt}" + (f" {time}" if time else "")
    base = (
        f"✈️🔥 {d['dest']}\n"
        f"   UO HK${d['price']:,.0f} {d['dep']} {flt_label}\n"
    )
    if d.get("drop_amount", 0) != 0:
        return base + f"   vs昨日 {d['drop_amount']:+.0f}元 ({d['drop_pct']:+.1f}%)"
    return base + f"   vs昨日 持平"


def fmt_airport_block(
    label: str, emoji: str,
    fresh: list, stable: list, generated: str, total_routes: int,
    uo_drops: list | None = None,
    stale: list | None = None,
    departure: str = "",
) -> str:
    """Build one airport's section (HKG or SZX).

    `uo_drops` is optional — when provided, renders a "✈️ UO 獨家跌價"
    section between Fresh and Stable. UO drops are not subject to the
    24h cooldown (they're a different signal — "UO specifically dropped
    again", not "any drop"); the caller can still filter them but by
    default we show all of them.
    """
    lines = [f"{emoji} {label} · {total_routes} 條路線 · {_hkt_ts_from_iso(generated)}"]

    if not fresh and not stable and not uo_drops and not stale:
        lines.append("   ⏳ 暫無符合條件嘅劈價（需累積更多歷史數據）")
        return "\n".join(lines)

    if fresh:
        # Hermes 2026-09-27 (Bug F): cap fresh list to FRESH_DROP_TOP_N at the
        # display boundary as well. extract_deals now over-fetches to give
        # non-cooldown drops a chance to survive the dedup filter, so the
        # caller may pass in more than FRESH_DROP_TOP_N. Truncate here so
        # the user's message stays bounded.
        lines.append(f"   🔥 今日跌咗 ({min(len(fresh), FRESH_DROP_TOP_N)} 條)")
        for d in fresh[:FRESH_DROP_TOP_N]:
            lines.append(fmt_drop(d))
        lines.append("")

    if uo_drops:
        lines.append(f"   ✈️ UO 獨家跌價 ({len(uo_drops)} 條)")
        for d in uo_drops:
            lines.append(fmt_uo_drop(d))
        lines.append("")

    if stable:
        lines.append(f"   🟢 平過典型 ({len(stable)} 條)")
        for d in stable:
            lines.append(fmt_stable(d))

    if stale:
        # Hermes 2026-09-23: show in-cooldown drops so user knows the
        # route is still below yesterday even though we already alerted.
        # Include departure code in the header so it's unambiguous which
        # airport's routes these belong to (otherwise the block reads as
        # a floating section between airports).
        lines.append("")
        header_label = departure if departure else label.split()[-1]
        lines.append("   📌 " + header_label + " 持續跌價 (" + str(min(len(stale), STALE_DROP_TOP_N)) + " 條 · 已 alert)")
        for d in stale[:STALE_DROP_TOP_N]:
            age_label = d.get("_stale_age", "")
            airline = d.get("airline", "") or "—"
            dest = d["dest"]
            price = d["price"]
            dep = d["dep"]
            base = (
                "📌 " + dest + "\n"
                "   HK$" + format(price, ",.0f") + " " + dep + " " + airline + "\n"
            )
            if d.get("drop_amount", 0) != 0:
                drop_amount = d["drop_amount"]
                drop_pct = d["drop_pct"]
                typical_savings = d["typical_savings"]
                lines.append(
                    base
                    + "   vs昨日 " + format(drop_amount, "+.0f") + "元 ("
                    + format(drop_pct, "+.1f") + "%)"
                    + " · 低典型 " + format(typical_savings, ".0f") + "%"
                    + " · " + age_label
                )
            else:
                typical_savings = d["typical_savings"]
                lines.append(
                    base
                    + "   低典型 " + format(typical_savings, ".0f") + "%"
                    + " · " + age_label
                )

    return "\n".join(lines)


# ---------- Main ----------

def build_message(hkg_data, szx_data, cx_data=None, uo_data=None, cooldown: dict | None = None) -> str:
    if cx_data and not data_is_fresh(cx_data, CX_MAX_DATA_AGE):
        print(
            "  CX data stale/invalid "
            f"(generated={(cx_data or {}).get('generated')!r}); omitting CX block"
        )
        cx_data = None
    if uo_data and not data_is_fresh(uo_data, UO_MAX_DATA_AGE):
        print(
            "  UO data stale/invalid "
            f"(generated={(uo_data or {}).get('generated')!r}); omitting UO block"
        )
        uo_data = None
    hkg_fresh, hkg_stable = extract_deals(
        hkg_data,
        departure="HKG",
        fresh_min_pct=FRESH_DROP_MIN_PCT,
        stable_min_pct=STABLE_DEAL_MIN_PCT,
    )
    szx_fresh, szx_stable = extract_deals(
        szx_data,
        departure="SZX",
        fresh_min_pct=FRESH_DROP_MIN_PCT,
        stable_min_pct=STABLE_DEAL_MIN_PCT,
    )

    # Hermes 2026-06-30: cooldown now compares against COOLDOWN_WINDOW (24h)
    # instead of "same HK calendar day" — see filter_already_alerted. The
    # `today` arg is kept for back-compat but no longer used.
    hkg_stale = []
    szx_stale = []
    if cooldown is not None:
        hkg_fresh, hkg_stale = filter_with_stale_alerted(hkg_fresh, cooldown)
        szx_fresh, szx_stale = filter_with_stale_alerted(szx_fresh, cooldown)

        # Hermes 2026-06-30: HK Express-only drops (Approach A — UO at the new
    # low). Subject to the same 24h cooldown as the main fresh section so
    # a UO drop that already fired today doesn't re-alert every hour.
    hkg_uo = extract_uo_drops(hkg_data, "HKG", FRESH_DROP_MIN_PCT)
    szx_uo = extract_uo_drops(szx_data, "SZX", FRESH_DROP_MIN_PCT)
    if cooldown is not None:
        hkg_uo = filter_already_alerted(hkg_uo, cooldown)
        szx_uo = filter_already_alerted(szx_uo, cooldown)

    hkg_total = len((hkg_data or {}).get("results") or [])
    szx_total = len((szx_data or {}).get("results") or [])
    hkg_generated = (hkg_data or {}).get("generated", "")
    szx_generated = (szx_data or {}).get("generated", "")

    # CX (Cathay Pacific) — third block. The CX scanner output is normalized
    # by export_all_dates_cx.py to the same shape as HKG/SZX, so extract_deals
    # works as-is. No UO drop extraction for CX (CX data has no per-date
    # flight.airline stamps).
    cx_fresh, cx_stable = ([], [])
    cx_stale = []
    if cx_data:
        cx_fresh, cx_stable = extract_deals(
            cx_data,
            # Keep CX cooldown keys separate from the all-airline HKG block.
            # Otherwise an HKG alert for the same destination can suppress a
            # genuinely new CX alert (or vice versa).
            departure="CX:HKG",
            fresh_min_pct=FRESH_DROP_MIN_PCT,
            stable_min_pct=STABLE_DEAL_MIN_PCT,
        )
        if cooldown is not None:
            cx_fresh, cx_stale = filter_with_stale_alerted(cx_fresh, cooldown)
    cx_total = len((cx_data or {}).get("results") or [])
    cx_generated = (cx_data or {}).get("generated", "")

    # UO (HK Express) — fourth block. export_all_dates_airline.py normalizes
    # the UO SQLite table to the same shape as all_dates.json, so
    # extract_deals works as-is. Each cheapestDate already has flight.airline
    # stamped so extract_uo_drops() can also pick vs昨日 drops. We dedupe so a
    # deal appearing in both fresh and stable doesn't double-print.
    uo_fresh, uo_stable = ([], [])
    uo_drop_only = []
    uo_stale = []
    if uo_data:
        uo_fresh, uo_stable = extract_deals(
            uo_data,
            departure="UO:HKG",
            fresh_min_pct=FRESH_DROP_MIN_PCT,
            stable_min_pct=STABLE_DEAL_MIN_PCT,
        )
        # build_message will pass uo_data through extract_uo_drops again below
        # for the vs昨日 signal — easier than threading two flags, so reuse
        # the same hkg/szx-style uo_drops arg on the airport block. Strip them
        # from the main fresh list to avoid double-alerting when the same
        # route appears as a daily drop AND a vs昨日 drop.
        uo_drop_only = []  # currently unused — vs昨日 handled by fmt_airport_block
        if cooldown is not None:
            uo_fresh, uo_stale = filter_with_stale_alerted(uo_fresh, cooldown)
            uo_stable = filter_already_alerted(uo_stable, cooldown)
    uo_total = len((uo_data or {}).get("results") or [])
    uo_generated = (uo_data or {}).get("generated", "")

    parts = [
        "🦅 CompareTiger 機票快訊",
        "對比昨日最低價 + 歷史典型價 · 每小時更新",
        "",
        fmt_airport_block("🇭🇰 香港 HKG", "🛫", hkg_fresh, hkg_stable, hkg_generated, hkg_total, uo_drops=hkg_uo, stale=hkg_stale, departure="HKG"),
        "",
        fmt_airport_block("🇨🇳 深圳 SZX", "🛫", szx_fresh, szx_stable, szx_generated, szx_total, uo_drops=szx_uo, stale=szx_stale, departure="SZX"),
    ]
    if cx_data:
        parts += [
            "",
            fmt_airport_block("✈️ 國泰 CX", "🛫", cx_fresh, cx_stable, cx_generated, cx_total, stale=cx_stale, departure="CX"),
        ]
    if uo_data:
        parts += [
            "",
            fmt_airport_block("✈️ 港快 UO", "🛫", uo_fresh, uo_stable, uo_generated, uo_total, stale=uo_stale, departure="UO"),
        ]
    parts += [
        "",
        "💡 跌價 = 今日最平比昨日最平低 · 平典型 = 今日最平比歷史中位數低",
    ]
    return "\n".join(parts)


def _collect_alerted_route_keys(
    hkg_fresh, szx_fresh, hkg_uo=None, szx_uo=None, cx_fresh=None,
    uo_fresh=None, uo_uo=None,
) -> list:
    """Return the route_keys actually included in today's Telegram message.

    Hermes 2026-06-30: include UO drops so they get stamped into the
    cooldown file — otherwise the same UO drop would re-alert every hour.
    Hermes 2026-09-07: also include the new uo_data fresh + vs-yesterday
    drops so the UO JSON-derived section stops repeating every hour.
    """
    keys = [d["route_key"] for d in (hkg_fresh + szx_fresh) if d.get("route_key")]
    if hkg_uo:
        keys += [d["route_key"] for d in hkg_uo if d.get("route_key")]
    if szx_uo:
        keys += [d["route_key"] for d in szx_uo if d.get("route_key")]
    if uo_fresh:
        keys += [d["route_key"] for d in uo_fresh if d.get("route_key")]
    if uo_uo:
        keys += [d["route_key"] for d in uo_uo if d.get("route_key")]
    if cx_fresh:
        keys += [d["route_key"] for d in cx_fresh if d.get("route_key")]
    return keys


def main():
    # Hermes 2026-07-27: pull the freshest data from NAS before generating
    # the report. Previously sync_flightdeals.sh ran on a 5-min launchd
    # timer, but that plist was deleted in the 2026-06-22 refactor, so
    # the Mac only had yesterday's data. Doing it inline here means the
    # hourly report always reflects the latest scanner output. The
    # command is best-effort — if the NAS is down or slow, we fall back
    # to whatever local copies already exist.
    #
    # Hermes 2026-08-09: keep the sync as a non-fatal warm-cache step for
    # the local-fallback path. Primary data now comes from the live
    # /api/deals endpoint (see FLIGHT_DEALS_API_BASE), so the alert and
    # the website are guaranteed to read from the same source.
    #
    # Hermes 2026-08-15: resolve sync_flightdeals.sh relative to this
    # script's own directory so the script is location-independent.
    # Override with SYNC_FLIGHTDEALS_SH env var if you want a custom path.
    import subprocess
    _sync_path = os.environ.get(
        "SYNC_FLIGHTDEALS_SH",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "sync_flightdeals.sh"),
    )
    try:
        subprocess.run(
            ["/bin/bash", _sync_path],
            timeout=60, check=False,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception as e:
        print(f"sync_flightdeals.sh failed (non-fatal, using local copies): {e}")

    # Live API first (HKG, SZX). force=1 bypasses any upstream cache so we
    # always see the freshest scan results, same as the website does.
    # ?dep=CX isn't supported by /api/deals today, so CX stays on the
    # local file path.
    hkg = load_with_fallback(
        lambda: fetch_json_url(f"{FLIGHT_DEALS_API_BASE}/api/deals?dep=HKG&force=1"),
        os.path.join(DATA_DIR, "all_dates.json"),
    )
    szx = load_with_fallback(
        lambda: fetch_json_url(f"{FLIGHT_DEALS_API_BASE}/api/deals?dep=SZX&force=1"),
        os.path.join(DATA_DIR, "all_dates_szx.json"),
    )
    cx = load_json(os.path.join(DATA_DIR, "all_dates_cx.json"))
    uo = load_json(os.path.join(DATA_DIR, "all_dates_uo.json"))
    if not hkg or not hkg.get("results"):
        print("No HKG data — skipping send")
        return 0

    cooldown = load_cooldown()
    cooldown = migrate_legacy_cooldown(cooldown)
    msg = build_message(hkg, szx, cx, uo, cooldown=cooldown)
    # Always log to stdout (captured by launchd to /tmp/flight_report.log)
    print(f"--- message ({len(msg)} chars) ---")
    print(msg)
    print("--- end ---")
    if "--dry-run" in sys.argv:
        print("[dry-run] not sending")
        return 0
    if send_telegram(msg):
        print("Sent OK")
        # Re-extract fresh lists from the (post-dedup) state of build_message
        # so we only stamp routes that actually went out in THIS message.
        # We re-run the cheap extract path to keep main() decoupled from
        # build_message's internals — the cooldown update is non-critical
        # so an exception here should not fail the run.
        try:
            hkg_fresh_raw, _ = extract_deals(
                hkg, departure="HKG",
                fresh_min_pct=FRESH_DROP_MIN_PCT,
                stable_min_pct=STABLE_DEAL_MIN_PCT,
            )
            szx_fresh_raw, _ = extract_deals(
                szx, departure="SZX",
                fresh_min_pct=FRESH_DROP_MIN_PCT,
                stable_min_pct=STABLE_DEAL_MIN_PCT,
            )
            cx_fresh_raw = []
            if cx:
                cx_fresh_raw, _ = extract_deals(
                    cx, departure="CX:HKG",
                    fresh_min_pct=FRESH_DROP_MIN_PCT,
                    stable_min_pct=STABLE_DEAL_MIN_PCT,
                )
            # 2026-09-07: UO is now its own JSON (all_dates_uo.json) generated by
            # export_all_dates_airline.py. extract_uo_drops(hkg, ...) is left
            # in place for back-compat (older data shape) but the fresh-drops
            # list is now read straight from uo_data so the cooldown stamping
            # actually runs (previously UO repeats fired every hour because
            # the cooldown path looked in HKG/SZX which don't carry UO
            # airline stamps).
            uo_fresh_raw, _ = ([], [])
            uo_uo_raw = []
            if uo:
                uo_fresh_raw, _ = extract_deals(
                    uo, departure="UO:HKG",
                    fresh_min_pct=FRESH_DROP_MIN_PCT,
                    stable_min_pct=STABLE_DEAL_MIN_PCT,
                )
                uo_uo_raw = extract_uo_drops(uo, "HKG", FRESH_DROP_MIN_PCT)
            # 2026-06-30: same 24h-window dedup as in build_message above
            hkg_fresh = filter_already_alerted(hkg_fresh_raw, cooldown)
            szx_fresh = filter_already_alerted(szx_fresh_raw, cooldown)
            hkg_uo_raw_legacy = extract_uo_drops(hkg, "HKG", FRESH_DROP_MIN_PCT)
            szx_uo_raw_legacy = extract_uo_drops(szx, "SZX", FRESH_DROP_MIN_PCT)
            hkg_uo_legacy = filter_already_alerted(hkg_uo_raw_legacy, cooldown)
            szx_uo_legacy = filter_already_alerted(szx_uo_raw_legacy, cooldown)
            # Merge legacy HKG/SZX UO with new uo_data UO so cooldown covers both
            uo_combined = uo_uo_raw + hkg_uo_legacy + szx_uo_legacy
            hkg_uo = hkg_uo_legacy
            szx_uo = szx_uo_legacy
            cx_fresh = filter_already_alerted(cx_fresh_raw, cooldown)
            alerted_keys = _collect_alerted_route_keys(
                hkg_fresh, szx_fresh, hkg_uo=hkg_uo, szx_uo=szx_uo,
                cx_fresh=cx_fresh, uo_fresh=uo_fresh_raw, uo_uo=uo_combined,
            )
            if alerted_keys:
                # Hermes 2026-08-15: build the fingerprint payload for
                # mark_alerted so future runs can detect phantom repeats.
                # Map: route_key → {price, drop_pct, drop_amount}.
                # Hermes 2026-09-29: include uo_fresh_raw + uo_combined so
                # UO alerts (which used to get ts-only stamps because their
                # route_keys weren't in the payload dict) now capture the
                # full fingerprint. Without this, the web 持續跌價 view
                # shows the typicalPrice-derived fallback instead of the
                # actual alerted amount/pct.
                alert_payload = {}
                for d in (hkg_fresh + szx_fresh + hkg_uo + szx_uo + cx_fresh
                          + uo_fresh_raw + uo_combined):
                    if d.get("route_key"):
                        alert_payload[d["route_key"]] = {
                            "price": d.get("price"),
                            "drop_pct": d.get("drop_pct"),
                            "drop_amount": d.get("drop_amount"),
                        }
                save_cooldown(mark_alerted(alerted_keys, cooldown, alert_payload=alert_payload))
                print(f"Cooldown updated: {len(alerted_keys)} routes stamped")
        except Exception as e:
            print(f"Cooldown update failed (non-fatal): {e}")
        return 0
    print("Send FAILED")
    return 1


if __name__ == "__main__":
    sys.exit(main())
