#!/usr/bin/env python3
"""CX (Cathay Pacific) deal exporter.

Reads the latest CX scanner run from /app/cx/scripts/run_latest_cx.json
on the NAS, normalizes it to the same shape as HKG/SZX all_dates.json, and
writes /data/all_dates_cx.json so the Mac's send_flight_report.py can treat
it identically to HKG/SZX.

Why a separate exporter?
  The CX scanner (run_cx_v18c.py) produces a much simpler result format
  than the HKG/SZX all-airlines scanners:
    - One best-date per route (no per-day `cheapestDates[]` array)
    - typical_low/high/avg are scalars (no `history.1d/4d/7d` baselines
      per date)
    - `all_dates` is the raw [[date, price], ...] list from the Google
      Flights grid scan

  To plug CX into the existing `extract_deals()` in send_flight_report.py,
  we have to manufacture a `cheapestDates` array with synthetic
  `history.4d` baselines (so a 1d-baseline-less brand-new low still has
  something to compare against) and a `typicalPrice` (we use typical_avg).
  This gives the Telegram report a "today vs typical" line for every CX
  route. The vs昨日 line will be empty for CX routes until we add daily
  history tracking — a known limitation documented below.

Output shape (matches all_dates.json):
  {
    "generated": "2026-07-27T11:30:00+08:00",   # Asia/Hong_Kong
    "results": [
      {
        "route": "HKG→NRT",
        "destination": {"code": "NRT", "name": "東京成田 (NRT)"},
        "price": 4053,
        "typicalPrice": 4053,
        "cheapestDates": [
          {"day": 6, "month": 11, "year": 2026, "price": 4053.0, "history": {}}
        ],
        "totalDates": 14
      },
      ...
    ]
  }

Limitations (intentional, to keep this exporter small):
  * vs昨日 delta for CX is a proxy against typical_avg (not a real
    yesterday baseline). The "vs昨日" line in the report therefore reads
    as "vs typical price" until we add a per-date history table for CX.
    Good enough for an alert; not accurate as a true "price moved today"
    signal. To get real per-date history we'd need the CX scanner to
    write a `historical_prices` row each run.
  * `typicalPrice` is set to `typical_avg` (rounded), so the
    `typical_savings` shown is 0% for every route. Future: read
    `historical_prices` from the database to get a real rolling median.

Triggers:
  - Manual: python3 export_all_dates_cx.py
  - launchd runs sync_flightdeals.sh which pulls /data/all_dates_cx.json
    from this container.

Run target: flight-scanner-cx container on NAS, /app/cx/scripts/.
"""
from __future__ import annotations
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

RUN_LATEST = Path("/app/scripts/scan_results/run_latest_cx.json")
# Output goes in the same dir as the scanner's own scan_results:
# /app/scripts/scan_results/ inside the container, which is bind-mounted
# from /volume1/flight-scanner/scripts/scan_results/ on the NAS.
# sync_flightdeals.sh on the Mac pulls this path back. Naming it
# "all_dates_cx.json" (not "run_latest_cx.json") avoids clashing with the
# scanner's own live output.
OUT_PATH = Path("/app/scripts/scan_results/all_dates_cx.json")

# City name table (mirrors CITY_NAMES in send_flight_report.py + the few
# HKE routes the CX scanner covers). Keep in sync if routes.json gains
# new codes.
CX_CITY_NAMES = {
    "NRT": "東京成田", "HND": "東京羽田", "KIX": "大阪", "NGO": "名古屋",
    "FUK": "福岡", "CTS": "札幌", "OKA": "沖繩", "ICN": "首爾",
    "PUS": "釜山", "TPE": "台北", "KHH": "高雄", "BKK": "曼谷",
    "HKT": "布吉", "SIN": "新加坡", "MNL": "馬尼拉", "SGN": "胡志明市",
    "KUL": "吉隆坡", "CGK": "雅加達", "HAN": "河內", "RGN": "仰光",
    "PEN": "檳城", "PVG": "上海", "PEK": "北京", "CAN": "廣州",
    "SZX": "深圳", "XIY": "西安", "CTU": "成都", "DXB": "杜拜",
    "DOH": "多哈", "LHR": "倫敦", "CDG": "巴黎", "FRA": "法蘭克福",
    "AMS": "阿姆斯特丹", "FCO": "羅馬", "MAD": "馬德里", "BCN": "巴塞羅那",
    "JFK": "紐約", "LAX": "洛杉磯", "SFO": "三藩市", "ORD": "芝加哥",
    "SEA": "西雅圖", "YVR": "溫哥華", "SYD": "悉尼", "MEL": "墨爾本",
    "AKL": "奧克蘭", "BOM": "孟買", "DEL": "德里", "CMB": "科倫坡",
    "JNB": "約翰內斯堡", "CAI": "開羅",
}


def _hk_now() -> str:
    """Return current Asia/Hong_Kong time as ISO 8601."""
    hk = timezone(timedelta(hours=8))
    return datetime.now(hk).strftime("%Y-%m-%dT%H:%M:%S+08:00")


def _parse_date(s: str) -> tuple[int, int, int] | None:
    """Parse YYYY-MM-DD → (year, month, day)."""
    try:
        dt = datetime.strptime(s, "%Y-%m-%d")
        return dt.year, dt.month, dt.day
    except (ValueError, TypeError):
        return None


def convert(cx_data: dict) -> dict:
    """Normalize CX scanner output → HKG all_dates.json shape."""
    results_in = cx_data.get("results") or []
    out_results = []
    for r in results_in:
        route = r.get("route", "")
        if "→" not in route:
            continue
        dest_code = route.split("→", 1)[1].strip()
        if not dest_code:
            continue
        best = r.get("best") or {}
        price = best.get("price")
        if not price or price <= 0:
            continue
        dep = _parse_date(best.get("dep", ""))
        if dep is None:
            continue
        year, month, day = dep
        typical = best.get("typical_avg") or 0
        results_in_count = best.get("dates_checked", 0)

        out_results.append({
            "route": route,
            "destination": {
                "code": dest_code,
                "name": f"{CX_CITY_NAMES.get(dest_code, dest_code)} ({dest_code})",
            },
            "price": price,
            "typicalPrice": int(typical) if typical else 0,
            "cheapestDates": [
                {
                    "day": day,
                    "month": month,
                    "year": year,
                    "price": float(price),
                    "stay": best.get("stay", 7),
                    # Synthetic history baseline: the route's typical_avg
                    # acts as the "yesterday price" so extract_deals() can
                    # compute a vs昨日 delta. The report will show
                    # "vs昨日 -1534元 (-43.6%) · 低典型 44%" for HKG→CAN
                    # in the current run. The 4d window is the longest
                    # extract_deals() checks, so it survives even when
                    # the HKG/SZX scanners write their own 1d/4d/7d
                    # baselines (which they don't for CX — CX has no
                    # historical_prices table).
                    "history": {
                        "4d": {
                            "price": int(typical) if typical else 0,
                            "diff": 0,
                            "pct": 0,
                        },
                    },
                }
            ],
            "totalDates": results_in_count,
            "airline": "CX",
        })

    return {
        "generated": _hk_now(),
        "scanner": "cx",
        "results": out_results,
    }


def main() -> int:
    if not RUN_LATEST.exists():
        print(f"ERROR: {RUN_LATEST} not found — CX scanner hasn't run yet")
        return 1
    try:
        cx_data = json.loads(RUN_LATEST.read_text())
    except Exception as e:
        print(f"ERROR: failed to parse {RUN_LATEST}: {e}")
        return 1
    if not cx_data.get("results"):
        print("WARN: CX run_latest has no results — writing empty export")
    out = convert(cx_data)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Atomic write: tmp + replace, so a half-written file can't be read
    # by sync_flightdeals.sh mid-flight.
    tmp = OUT_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    os.replace(tmp, OUT_PATH)
    print(f"Wrote {OUT_PATH}: {len(out['results'])} routes, generated={out['generated']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
