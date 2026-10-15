#!/usr/bin/env python3
"""
Hermes 2026-10-15: export drop_alerts.db → src/data/drop_alerts.json

The /api/alerts endpoint on Vercel can't read the Mac's local SQLite, so
this script dumps the live alerts to JSON which Vercel can serve. The JSON
is committed to git and deployed alongside the page.

GC: filters out entries with expires_at < now (24h after detection).
This matches the bot's COOLDOWN_WINDOW — once an alert's been around for
24h, neither the bot nor the page should surface it as "持續跌價".

Output shape:
{
  "generated": "2026-10-15T19:50:00+08:00",
  "alerts": [
    {
      "id": 37,
      "key": "20261015HKCXalertNGO",
      "detected_at": "2026-10-15T09:00:13+08:00",
      "expires_at": "2026-10-16T09:00:13+08:00",
      "airport": "HKG",
      "airline": "CX",
      "dest_code": "NGO",
      "dest_name": "名古屋",
      "region": null,
      "price": 3910,
      "old_price": 4320,
      "drop_amount": 410,
      "drop_pct": 9.49,
      ...
    }
  ]
}
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

SQL_PATH = os.path.expanduser("~/.cache/comparetiger/drop_alerts.db")
JSON_PATH = os.path.expanduser("~/flight-deals-app/src/data/drop_alerts.json")
HK_TZ = ZoneInfo("Asia/Hong_Kong")


def main():
    if not os.path.exists(SQL_PATH):
        print(f"ERROR: SQL not found at {SQL_PATH}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(SQL_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # GC: only include non-expired alerts (expires_at > now)
    now_hk = datetime.now(HK_TZ)
    now_iso = now_hk.isoformat()
    cur.execute(
        "SELECT * FROM alerts WHERE expires_at > ? ORDER BY detected_at DESC",
        (now_iso,),
    )
    alerts = [dict(row) for row in cur.fetchall()]
    conn.close()

    # Build a legacy "cooldown" map for backwards compat with the page
    # code that still uses /api/deals. The cooldown key format here is
    # the same as before: "HKG→dest_name (dest_code)". This lets the
    # page's existing cooldown-override logic keep working until the
    # page fully migrates to /api/alerts.
    cooldown = {}
    for a in alerts:
        key = f"{a['airport']}→{a['dest_name']} ({a['dest_code']})"
        cooldown[key] = {
            "amount": -a["drop_amount"] if a.get("drop_amount") else None,
            "pct": -a["drop_pct"] if a.get("drop_pct") else None,
            "price": a.get("price"),
            "ts": a.get("detected_at"),
        }

    payload = {
        "generated": now_iso,
        "alerts": alerts,
        # Legacy fields - keep the page's existing cooldown logic working
        "cooldown": cooldown,
    }

    os.makedirs(os.path.dirname(JSON_PATH), exist_ok=True)
    # Atomic write: write to .tmp then rename (prevents half-written file)
    tmp_path = JSON_PATH + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, JSON_PATH)

    expired_count = len(alerts)
    print(
        f"✓ Wrote {expired_count} non-expired alerts to {JSON_PATH} "
        f"(expired entries filtered out, 24h TTL applied)"
    )


if __name__ == "__main__":
    main()
