"""Tests for scanner/detail_scan_safety.py.

The safety primitives are independent of the live NAS, SQLite, and
Google Flights endpoints — pure-Python state machines. Tests use
`tmp_path` for the persistent state files so they don't touch any
real `/data/` sentinel.
"""

import json
import os
import time
import unittest
from pathlib import Path

from detail_scan_safety import (
    CircuitOpen,
    DailyRouteQuota,
    DEFAULT_DAILY_ROUTE_QUOTA,
    DetailScanError,
    EmptyResults,
    ProviderBlocked,
    ProviderDenied,
    ProviderSchemaChanged,
    QuotaExceeded,
    circuit_is_open,
    close_circuit,
    mark_provider_blocked,
    open_circuit,
    raise_if_circuit_open,
    read_circuit_reason,
)


class TestExceptionHierarchy(unittest.TestCase):
    def test_all_inherit_from_detail_scan_error(self):
        for cls in (ProviderBlocked, ProviderDenied, ProviderSchemaChanged,
                    EmptyResults, QuotaExceeded, CircuitOpen):
            self.assertTrue(
                issubclass(cls, DetailScanError),
                f"{cls.__name__} must inherit from DetailScanError",
            )

    def test_distinct_classes(self):
        # A provider-side ban is NOT an empty result. A genuine empty
        # is NOT a circuit-open. The whole point is to be able to
        # tell them apart in except clauses.
        self.assertFalse(issubclass(ProviderBlocked, EmptyResults))
        self.assertFalse(issubclass(EmptyResults, ProviderBlocked))
        self.assertFalse(issubclass(CircuitOpen, QuotaExceeded))

    def test_caught_as_base_class(self):
        # Scanners can `except DetailScanError` and catch any subclass.
        with self.assertRaises(DetailScanError):
            raise ProviderBlocked("test")

        with self.assertRaises(DetailScanError):
            raise EmptyResults("test")


class TestCircuitBreaker(unittest.TestCase):
    def setUp(self):
        self.path = "/tmp/test_circuit_breaker"

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_circuit_closed_by_default(self):
        self.assertFalse(circuit_is_open(self.path))
        # raise_if_circuit_open should NOT raise when no sentinel.
        raise_if_circuit_open(self.path)

    def test_open_circuit_creates_sentinel(self):
        open_circuit("test reason", self.path)
        self.assertTrue(circuit_is_open(self.path))

    def test_open_circuit_writes_payload(self):
        open_circuit("captcha interstitial on egress X", self.path)
        payload = json.loads(Path(self.path).read_text())
        self.assertIn("opened_at", payload)
        self.assertEqual(payload["reason"], "captcha interstitial on egress X")

    def test_raise_if_open_raises(self):
        open_circuit("test", self.path)
        with self.assertRaises(CircuitOpen) as ctx:
            raise_if_circuit_open(self.path)
        # The exception message includes the reason for operator logs.
        self.assertIn("test", str(ctx.exception))

    def test_close_circuit_removes_sentinel(self):
        open_circuit("test", self.path)
        self.assertTrue(circuit_is_open(self.path))
        close_circuit(self.path)
        self.assertFalse(circuit_is_open(self.path))

    def test_close_circuit_idempotent(self):
        # Closing when nothing is open should not raise.
        close_circuit(self.path)
        close_circuit(self.path)

    def test_read_reason_when_closed(self):
        self.assertIsNone(read_circuit_reason(self.path))

    def test_read_reason_handles_corrupt_payload(self):
        Path(self.path).write_text("not json {{{")
        # Read returns None rather than raising — defensive against
        # operator typos when opening the circuit manually.
        self.assertIsNone(read_circuit_reason(self.path))


class TestDailyRouteQuota(unittest.TestCase):
    def setUp(self):
        self.path = "/tmp/test_daily_route_quota.json"
        Path(self.path).unlink(missing_ok=True)

    def tearDown(self):
        Path(self.path).unlink(missing_ok=True)

    def test_default_cap_is_thirty(self):
        # Mirrors the conservative-throttle rule (≤30 dates/route/round).
        self.assertEqual(DEFAULT_DAILY_ROUTE_QUOTA, 30)

    def test_fresh_quota_is_zero(self):
        q = DailyRouteQuota(path=self.path)
        self.assertEqual(q.used("HKG→BKK"), 0)
        self.assertEqual(q.remaining("HKG→BKK"), 30)
        self.assertFalse(q.is_exhausted("HKG→BKK"))

    def test_record_increments(self):
        q = DailyRouteQuota(path=self.path)
        q.record("HKG→BKK")
        q.record("HKG→BKK")
        self.assertEqual(q.used("HKG→BKK"), 2)
        self.assertEqual(q.remaining("HKG→BKK"), 28)
        self.assertFalse(q.is_exhausted("HKG→BKK"))

    def test_exhaustion_at_cap(self):
        q = DailyRouteQuota(path=self.path, daily_cap=5)
        for _ in range(5):
            q.record("HKG→BKK")
        self.assertTrue(q.is_exhausted("HKG→BKK"))
        self.assertEqual(q.remaining("HKG→BKK"), 0)

    def test_exhaustion_does_not_wrap(self):
        # Recording past the cap should not wrap around or crash.
        q = DailyRouteQuota(path=self.path, daily_cap=3)
        for _ in range(10):
            q.record("HKG→BKK")
        self.assertEqual(q.used("HKG→BKK"), 10)
        self.assertEqual(q.remaining("HKG→BKK"), 0)
        self.assertTrue(q.is_exhausted("HKG→BKK"))

    def test_separate_routes_have_independent_quotas(self):
        q = DailyRouteQuota(path=self.path, daily_cap=3)
        q.record("HKG→BKK")
        q.record("HKG→BKK")
        q.record("HKG→BKK")
        # BKK exhausted, but NRT is fresh.
        self.assertTrue(q.is_exhausted("HKG→BKK"))
        self.assertFalse(q.is_exhausted("HKG→NRT"))

    def test_persists_across_instances(self):
        # Scanner restarts within the same UTC day must see the same counter.
        q1 = DailyRouteQuota(path=self.path, daily_cap=10)
        q1.record("HKG→BKK")
        q1.record("HKG→BKK")

        q2 = DailyRouteQuota(path=self.path, daily_cap=10)
        self.assertEqual(q2.used("HKG→BKK"), 2)
        self.assertFalse(q2.is_exhausted("HKG→BKK"))

    def test_stale_entries_are_evicted(self):
        # Write a payload with yesterday's date. Loading should drop it.
        yesterday = "2026-08-22"  # any past UTC date
        today = time.strftime("%Y-%m-%d", time.gmtime())
        if yesterday == today:
            # Test runs the same day, can't simulate. Skip.
            self.skipTest("today equals yesterday's stub date")
        payload = {
            "HKG→OLD": [yesterday, 99],   # stale — should be evicted
            "HKG→NEW": [today, 1],        # fresh — should remain
        }
        Path(self.path).write_text(json.dumps(payload))

        q = DailyRouteQuota(path=self.path)
        self.assertEqual(q.used("HKG→OLD"), 0)
        self.assertEqual(q.used("HKG→NEW"), 1)

    def test_corrupt_state_file_loads_as_empty(self):
        Path(self.path).write_text("not json {{{")
        q = DailyRouteQuota(path=self.path)
        self.assertEqual(q.used("HKG→BKK"), 0)
        self.assertFalse(q.is_exhausted("HKG→BKK"))

    def test_uses_env_override_when_explicitly_constructed(self):
        # Verify the daily_cap parameter is honored at construction time.
        q = DailyRouteQuota(path=self.path, daily_cap=7)
        self.assertEqual(q.cap, 7)

    def test_default_cap_constant_value(self):
        # Pin the documented default so an accidental change to the
        # constant is caught at test time.
        self.assertEqual(DEFAULT_DAILY_ROUTE_QUOTA, 30)


class TestSafetyPrimitiveIntegration(unittest.TestCase):
    """End-to-end: a scanner that uses both primitives correctly."""

    def setUp(self):
        self.circuit_path = "/tmp/test_int_circuit"
        self.quota_path = "/tmp/test_int_quota.json"
        for p in (self.circuit_path, self.quota_path):
            Path(p).unlink(missing_ok=True)

    def tearDown(self):
        for p in (self.circuit_path, self.quota_path):
            Path(p).unlink(missing_ok=True)

    def test_circuit_open_blocks_before_request(self):
        # Simulate the scanner pattern: raise_if_circuit_open() runs
        # before any provider call. If the circuit is open, the scanner
        # never even tries.
        open_circuit("captcha seen on egress X", self.circuit_path)

        def fake_search_call():
            raise_if_circuit_open(self.circuit_path)
            return "should not reach here"

        with self.assertRaises(CircuitOpen):
            fake_search_call()

    def test_quota_exhaustion_raises_quota_error(self):
        # The scanner's per-route cap. When exhausted, raise QuotaExceeded
        # instead of issuing more requests.
        quota = DailyRouteQuota(path=self.quota_path, daily_cap=2)
        quota.record("HKG→BKK")
        quota.record("HKG→BKK")

        # Scanner pattern: check then raise.
        with self.assertRaises(QuotaExceeded) as ctx:
            if quota.is_exhausted("HKG→BKK"):
                raise QuotaExceeded("daily cap reached for HKG→BKK")
        self.assertIn("HKG→BKK", str(ctx.exception))


class TestMarkProviderBlocked(unittest.TestCase):
    """mark_provider_blocked stamps `provider_status` on flight_details rows.

    This is the bridge between detail-scan safety primitives and the
    data model — once a row is marked 'blocked', the exporter can
    render "details unavailable" instead of stale detail data.
    """

    def setUp(self):
        # In-memory sqlite for test isolation. Mirrors the production
        # flight_details schema (provider_status column is added by the
        # migration in fli_db._ensure_schema — we create it here directly).
        import sqlite3
        self.conn = sqlite3.connect(":memory:")
        self.conn.execute("""
            CREATE TABLE flight_details (
                route TEXT NOT NULL,
                dep_date TEXT NOT NULL,
                ret_date TEXT NOT NULL,
                price REAL NOT NULL,
                scan_time TEXT NOT NULL,
                provider_status TEXT NOT NULL DEFAULT 'ok'
            )
        """)
        self.conn.execute("""
            INSERT INTO flight_details (route, dep_date, ret_date, price, scan_time)
            VALUES
                ('HKG→BKK', '2026-09-01', '2026-09-08', 4500, datetime('now')),
                ('HKG→BKK', '2026-09-15', '2026-09-22', 4800, datetime('now')),
                ('HKG→NRT', '2026-10-01', '2026-10-08', 5500, datetime('now')),
                ('HKG→BKK', '2026-08-01', '2026-08-08', 5000,
                 datetime('now', '-7 days'))
        """)

    def tearDown(self):
        self.conn.close()

    def test_mark_specific_route(self):
        n = mark_provider_blocked(self.conn, route="HKG→BKK",
                                  reason="blocked", max_age_hours=24)
        self.assertEqual(n, 2)  # The two fresh HKG→BKK rows

        # HKG→NRT untouched (different route).
        self.assertEqual(self._status("HKG→NRT", '2026-10-01'), "ok")
        # HKG→BKK fresh rows are stamped.
        self.assertEqual(self._status("HKG→BKK", '2026-09-01'), "blocked")
        self.assertEqual(self._status("HKG→BKK", '2026-09-15'), "blocked")
        # Old HKG→BKK row not touched (beyond max_age).
        self.assertEqual(self._status("HKG→BKK", '2026-08-01'), "ok")

    def test_mark_all_recent(self):
        # No route filter — the entire fleet has been warned.
        n = mark_provider_blocked(self.conn, reason="denied",
                                  max_age_hours=24)
        self.assertEqual(n, 3)  # All 3 fresh rows

        self.assertEqual(self._status("HKG→BKK", '2026-09-01'), "denied")
        self.assertEqual(self._status("HKG→BKK", '2026-09-15'), "denied")
        self.assertEqual(self._status("HKG→NRT", '2026-10-01'), "denied")
        # Old row preserved (still 'ok').
        self.assertEqual(self._status("HKG→BKK", '2026-08-01'), "ok")

    def test_idempotent_does_not_re_stamp(self):
        # First stamp: 2 rows.
        n1 = mark_provider_blocked(self.conn, route="HKG→BKK",
                                   reason="blocked", max_age_hours=24)
        self.assertEqual(n1, 2)
        # Second stamp on the same rows: 0 rows (already 'blocked').
        n2 = mark_provider_blocked(self.conn, route="HKG→BKK",
                                   reason="blocked", max_age_hours=24)
        self.assertEqual(n2, 0)

    def test_stale_rows_preserved(self):
        # max_age_hours=1 should not touch the 7-day-old row.
        n = mark_provider_blocked(self.conn, max_age_hours=1)
        self.assertEqual(n, 3)  # only the 3 fresh rows
        self.assertEqual(self._status("HKG→BKK", '2026-08-01'), "ok")

    def _status(self, route: str, dep_date: str) -> str:
        row = self.conn.execute(
            "SELECT provider_status FROM flight_details "
            "WHERE route=? AND dep_date=?",
            (route, dep_date),
        ).fetchone()
        return row[0] if row else "<missing>"


if __name__ == "__main__":
    unittest.main()
