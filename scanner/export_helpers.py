"""Deal-confidence + itinerary export helpers.

Used by `export_all_dates_hkg_v2.py` and `export_all_dates_szx.py` to
emit the new comparison + itinerary fields that the deals page needs
after the 2026-08-23 type-shape refactor.

Two pure-Python functions:

- `build_comparisons_for_route(route, date_context, pair_history)` returns
  `{dateComparison, historyComparison, marketComparison}` to attach at the
  route level.

- `build_itinerary_for_date(dep_date, ret_date, detail_row, last_verified,
   provider_status)` returns the per-date `itinerary` block
  (`status: 'selected' | 'not_collected' | 'stale'`).

Both wrap `deal_confidence.build_deal_confidence` and stay compatible
with the existing JSON consumers by preserving legacy fields like
`flight`, `last_verified`, `history`.

Why a thin wrapper module instead of calling `deal_confidence` directly
in each exporter?

- Exporters are flat scripts that copy/paste a lot of structure;
  putting the conversion in one place keeps the two exporters in sync.
- The legacy `flight` field stays for backward compat (the page still
  reads it); `itinerary` is additive. Both are emitted.
"""

from __future__ import annotations

import sqlite3
import sys
from typing import Iterable

# Make the scanner package's deal_confidence.py importable.
sys.path.insert(0, "/data")
sys.path.insert(0, "/install")

from deal_confidence import build_deal_confidence  # noqa: E402

# ── Re-export the canonical "not collected" reason from deal_confidence ─
# The deals page looks up this exact string to render the placeholder.
MARKET_NOT_COLLECTED_REASON = "requires_all_comparable_itineraries"


def build_comparisons_for_route(
    *,
    route: str,
    candidate_entry: dict,
    route_date_context: list,
    pair_history: Iterable,
) -> dict:
    """Wrap `build_deal_confidence` and return the 3 comparison blocks.

    Args:
        route: e.g. "HKG→BKK". Used in the result for debugging/logging
            only — the underlying deal_confidence doesn't need it.
        candidate_entry: the cheapest date row, dict with at least
            `{price, stay}`. This is what the comparator scores.
        route_date_context: list of dicts for all (dep_date, ret_date, price)
            rows in this route's calendar pool. Filtered by deal_confidence
            to only same-stay-length peers.
        pair_history: iterable of historical prices for the same (dep_date,
            ret_date) pair. Accepts any iterable — deal_confidence normalizes.

    Returns:
        Dict with keys `dateComparison`, `historyComparison`,
        `marketComparison` ready to merge into a FlightDeal object.
    """
    full = build_deal_confidence(
        candidate_entry,
        route_date_context,
        pair_history,
    )
    return {
        "dateComparison": full["dateComparison"],
        "historyComparison": full["historyComparison"],
        "marketComparison": full["marketComparison"],
    }


def build_itinerary_for_date(
    *,
    dep_date: str,
    ret_date: str,
    detail_row: dict | None,
    last_verified: str | None,
    provider_status: str | None,
    detail_max_age_hours: int = 24,
) -> dict:
    """Compute the new `itinerary` block for one (dep_date, ret_date) row.

    Returns a dict that matches the `Itinerary` interface in
    `src/types/flight.ts`:

        {
          status: 'selected' | 'not_collected' | 'stale',
          source: 'flight_details' | 'flight_dates_fallback' | null,
          scannedAt: ISO string | null,
          outbound?: {airline, flight, depTime, arrTime},
          return?: {airline, flight, depTime, arrTime},
          retDate: string,
        }

    The status logic:

      not_collected  — detail_row is None (no flight_details record at all)
                        OR provider_status in {'blocked', 'denied',
                        'schema_changed'}.
      stale          — detail_row exists, provider_status='ok', but
                        last_verified is older than detail_max_age_hours.
      selected       — detail_row exists, provider_status='ok', scan_time
                        is within detail_max_age_hours.

    The UI uses `status` to decide between showing "selected itinerary"
    (with flight number, airline, times) or "details unavailable".
    """
    # No detail row at all → not_collected (calendar-only).
    if detail_row is None:
        return {
            "status": "not_collected",
            "source": "flight_dates_fallback",
            "scannedAt": None,
            "retDate": ret_date,
        }

    # Provider has marked this row as unsafe to display.
    if provider_status and provider_status != "ok":
        return {
            "status": "not_collected",
            "source": None,
            "scannedAt": last_verified,
            "retDate": ret_date,
        }

    # Check freshness against detail_max_age_hours.
    if last_verified is None:
        # detail_row exists but no scan_time? treat as stale rather than
        # not_collected — we have data, just no idea when it was written.
        return {
            "status": "stale",
            "source": "flight_details",
            "scannedAt": None,
            "retDate": ret_date,
        }

    is_fresh = _is_within_window(last_verified, detail_max_age_hours)
    if not is_fresh:
        return {
            "status": "stale",
            "source": "flight_details",
            "scannedAt": last_verified,
            "retDate": ret_date,
        }

    # Fresh detail row — emit the full itinerary.
    return {
        "status": "selected",
        "source": "flight_details",
        "scannedAt": last_verified,
        "outbound": {
            "airline": detail_row.get("outbound_airline"),
            "flight": detail_row.get("outbound_flight"),
            "depTime": detail_row.get("outbound_dep_time"),
            "arrTime": detail_row.get("outbound_arr_time"),
        },
        "return": {
            "airline": detail_row.get("return_airline"),
            "flight": detail_row.get("return_flight"),
            "depTime": detail_row.get("return_dep_time"),
            "arrTime": detail_row.get("return_arr_time"),
        },
        "retDate": ret_date,
    }


def _is_within_window(last_verified: str, max_age_hours: int) -> bool:
    """True if last_verified is within max_age_hours of now.

    last_verified is stored as 'YYYY-MM-DD HH:MM:SS' (local HKT). We
    compare against UTC now() — the ~8h skew is small enough not to
    matter for the 24h window.
    """
    from datetime import datetime, timedelta

    try:
        # Try the HKG-style timestamp first.
        if " " in last_verified:
            ts = datetime.strptime(last_verified, "%Y-%m-%d %H:%M:%S")
        else:
            ts = datetime.fromisoformat(last_verified)
    except (ValueError, TypeError):
        # Unparseable timestamp — assume fresh (best effort).
        return True

    age = datetime.now() - ts
    return age <= timedelta(hours=max_age_hours)


def load_provider_status_for_routes(
    conn: sqlite3.Connection,
    *,
    departure: str,
    max_age_hours: int = 24,
) -> dict[tuple[str, str, str], str]:
    """Load (route, dep_date, ret_date) → provider_status for recent rows.

    Used by the exporter to know which flight_details rows are still
    safe to display after a ProviderBlocked signal. Returned dict only
    contains rows whose provider_status is NOT 'ok' — exporters default
    to 'ok' for any (route, dep_date, ret_date) not in the dict.
    """
    cur = conn.cursor()
    cur.execute(
        """
        SELECT route, dep_date, ret_date, provider_status
        FROM flight_details
        WHERE departure = ?
          AND scan_time >= datetime('now', ?)
          AND provider_status != 'ok'
        """,
        (departure, f"-{max_age_hours} hours"),
    )
    return {
        (row[0], row[1], row[2]): row[3]
        for row in cur.fetchall()
    }
