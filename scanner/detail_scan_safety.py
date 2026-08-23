"""Detail-scanner safety primitives.

Three independent primitives for the detail-scanner fleet:

1. Typed exception hierarchy — distinguishes a provider enforcement
   signal from a genuine "no flights" outcome, so the scanner can
   react instead of silently treating ban responses as empty results.
2. Fleet-wide circuit breaker — a sentinel file checked before every
   request. When the file exists, every scanner stops. Recovery is
   operator-initiated (rm the file).
3. Per-route daily quota — caps the worst-case load per route per day
   so a temporary broad price movement can't turn one round into
   thousands of detail queries.

These are the *minimal* defensive primitives. They don't fix the
underlying authorization issue (see Detail-Flight Scan Enforcement
Incident Review.md), they just keep the existing detail scanner code
inside a bounded request budget so it can't compound a ban when re-enabled.

The supervisor env still gates whether any scanner runs at all
(`HKG_DETAIL_ENABLED=0` etc.). These primitives add an in-process
safety net for when those envs are flipped back to 1.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any


# ----------------------------------------------------------------------------
# T3: typed exception hierarchy
# ----------------------------------------------------------------------------

class DetailScanError(Exception):
    """Base for all detail-scanner errors."""


class ProviderBlocked(DetailScanError):
    """The provider returned an enforcement signal (captcha interstitial,
    HTTP 403, hard ban). The fleet should halt — see fleet circuit
    breaker below. Distinct from EmptyResults so the scanner doesn't
    quietly retry on a banned IP."""


class ProviderDenied(DetailScanError):
    """Authorization-style failure (HTTP 401/403, login wall). Same
    fleet-halt semantics as ProviderBlocked but a separate class so
    dashboards can distinguish enforcement from auth issues."""


class ProviderSchemaChanged(DetailScanError):
    """The provider returned HTML that parsed without raising, but the
    fields we depend on are missing or wrong. Halt the scanner and
    flag for an operator review — do NOT keep writing malformed rows."""


class EmptyResults(DetailScanError):
    """Genuine "no flights match these dates" outcome. Not a ban signal —
    safe to continue to the next candidate."""


class QuotaExceeded(DetailScanError):
    """The per-route or per-day budget has been hit. Sleep until
    tomorrow, then continue."""


class CircuitOpen(DetailScanError):
    """The fleet-wide circuit breaker is open. Stop the entire scanner
    immediately. An operator must clear the sentinel file before any
    scanner may resume."""


# ----------------------------------------------------------------------------
# T4: fleet-wide circuit breaker
# ----------------------------------------------------------------------------

# Default sentinel path inside the fli-scheduler container.
DEFAULT_FLEET_CIRCUIT_PATH = "/data/.fleet_circuit_open"

# Optional payload the operator can drop into the sentinel file to
# record WHY the circuit is open (timestamp, reason, contact). Read
# by `read_circuit_reason()` for log output.
FLEET_CIRCUIT_PATH = os.environ.get("FLEET_CIRCUIT_PATH", DEFAULT_FLEET_CIRCUIT_PATH)


def circuit_is_open(path: str = FLEET_CIRCUIT_PATH) -> bool:
    """Return True if the fleet-wide circuit breaker is open."""
    return Path(path).exists()


def raise_if_circuit_open(path: str = FLEET_CIRCUIT_PATH) -> None:
    """Raise CircuitOpen if the circuit breaker is open. Call this
    before issuing the next provider request so a single ban signal
    halts the whole fleet without any extra coordination."""
    if circuit_is_open(path):
        reason = read_circuit_reason(path)
        raise CircuitOpen(
            f"fleet circuit open at {path}; operator must remove file to resume. "
            f"reason: {reason}"
        )


def read_circuit_reason(path: str = FLEET_CIRCUIT_PATH) -> str | None:
    """Best-effort read of the operator-written reason from the sentinel."""
    try:
        with open(path, "r") as f:
            payload = json.load(f)
        return payload.get("reason") if isinstance(payload, dict) else str(payload)
    except (FileNotFoundError, json.JSONDecodeError, IsADirectoryError, PermissionError):
        return None


def open_circuit(reason: str, path: str = FLEET_CIRCUIT_PATH) -> None:
    """Open the circuit breaker. Writes a JSON payload with the reason
    so log scrapers and operators can see WHY without reading git
    history. Idempotent — overwrites any existing payload."""
    payload = {
        "opened_at": int(time.time()),
        "reason": reason,
    }
    Path(path).write_text(json.dumps(payload, indent=2))


def close_circuit(path: str = FLEET_CIRCUIT_PATH) -> None:
    """Close the circuit breaker. Operator-initiated only — never call
    this from inside the scanner. The whole point of the breaker is
    that recovery is human-driven."""
    try:
        Path(path).unlink()
    except FileNotFoundError:
        pass


# ----------------------------------------------------------------------------
# T2 + T5: per-route daily quota
# ----------------------------------------------------------------------------

# Default per-route daily cap. Matches the conservative-throttle rule
# (≤30 dates per route per round, ≤1 round per day). Override via env
# only when an operator has done the math.
DEFAULT_DAILY_ROUTE_QUOTA = int(os.environ.get("DAILY_ROUTE_QUOTA", "30"))


class DailyRouteQuota:
    """Persistent per-route daily request counter.

    State lives at `/data/.daily_route_quota.json` so concurrent scanners
    in the same container see the same counter. The counter resets at
    UTC midnight — not at a fixed interval from when the scanner started
    — so multiple scanners syncing through the day all share the budget.

    Usage in a scanner:

        quota = DailyRouteQuota()
        if quota.is_exhausted(route):
            raise QuotaExceeded(...)
        ... do the request ...
        quota.record(route)

    The counter is intentionally simple: a flat per-day count keyed by
    (route, utc_date). No exponential smoothing, no carry-over. If a
    scanner hits the cap it sleeps until tomorrow and tries again.
    """

    def __init__(self, path: str = "/data/.daily_route_quota.json",
                 daily_cap: int = DEFAULT_DAILY_ROUTE_QUOTA):
        self._path = path
        self._cap = daily_cap
        self._today_utc = time.strftime("%Y-%m-%d", time.gmtime())
        self._state = self._load()

    @property
    def cap(self) -> int:
        return self._cap

    def _load(self) -> dict[str, int]:
        if not Path(self._path).exists():
            return {}
        try:
            with open(self._path, "r") as f:
                payload = json.load(f)
            # Drop entries from previous UTC days.
            return {
                route: count for route, (day, count) in payload.items()
                if day == self._today_utc
            } if isinstance(payload, dict) else {}
        except (json.JSONDecodeError, OSError):
            return {}

    def _save(self) -> None:
        # Write the full payload: route -> [utc_date, count]. Including
        # the date means stale entries auto-evict on the next load.
        payload = {route: [self._today_utc, count]
                   for route, count in self._state.items()}
        try:
            Path(self._path).write_text(json.dumps(payload, indent=2))
        except OSError:
            # If we can't write (read-only mount, etc.), fail open —
            # don't block scanning due to a quota-side bug. Log to stderr.
            print(f"[DailyRouteQuota] WARN: failed to write {self._path}",
                  file=sys.stderr)

    def used(self, route: str) -> int:
        return self._state.get(route, 0)

    def remaining(self, route: str) -> int:
        return max(0, self._cap - self.used(route))

    def is_exhausted(self, route: str) -> bool:
        return self.used(route) >= self._cap

    def record(self, route: str, count: int = 1) -> None:
        self._state[route] = self._state.get(route, 0) + count
        self._save()


def mark_provider_blocked(conn, *, route: str | None = None,
                         reason: str = "blocked",
                         max_age_hours: int = 24) -> int:
    """Stamp `provider_status` on recent flight_details rows.

    Called by a detail scanner the moment it detects a ProviderBlocked /
    ProviderDenied / ProviderSchemaChanged signal. The exporter reads this
    field to:
      - surface "details unavailable" in the UI for the affected route
      - avoid pinning a stale `flight_details` row in front of the fresh
        `flight_dates` price

    Args:
        conn: sqlite3 connection to /data/fli_calendar.db. Caller must
              hold a transaction (the rows update is a single UPDATE).
        route: if provided, only this route is stamped. If None, ALL
               recent rows for every route are stamped (used when the
               fleet circuit opens — the entire fleet's output is now
               suspect, regardless of which route triggered it).
        reason: human-readable value to write into provider_status.
                Use 'blocked', 'denied', or 'schema_changed'.
        max_age_hours: only stamp rows whose scan_time is fresher than
                       this. Defaults to 24h to mirror the export's
                       staleness threshold.

    Returns:
        Number of rows updated.
    """
    cur = conn.cursor()
    if route is not None:
        cur.execute(
            """
            UPDATE flight_details
            SET provider_status = ?
            WHERE route = ?
              AND scan_time >= datetime('now', ?)
              AND provider_status = 'ok'
            """,
            (reason, route, f"-{max_age_hours} hours"),
        )
    else:
        cur.execute(
            """
            UPDATE flight_details
            SET provider_status = ?
            WHERE scan_time >= datetime('now', ?)
              AND provider_status = 'ok'
            """,
            (reason, f"-{max_age_hours} hours"),
        )
    return cur.rowcount


__all__ = [
    "DetailScanError",
    "ProviderBlocked",
    "ProviderDenied",
    "ProviderSchemaChanged",
    "EmptyResults",
    "QuotaExceeded",
    "CircuitOpen",
    "circuit_is_open",
    "raise_if_circuit_open",
    "read_circuit_reason",
    "open_circuit",
    "close_circuit",
    "DailyRouteQuota",
    "DEFAULT_DAILY_ROUTE_QUOTA",
    "mark_provider_blocked",
]
