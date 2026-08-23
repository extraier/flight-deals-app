"""Tests for scanner/export_helpers.py.

The helper module wraps deal_confidence.build_deal_confidence and
provides two pure functions plus one DB read:
  - build_comparisons_for_route
  - build_itinerary_for_date
  - load_provider_status_for_routes

The pure functions are unit-tested without a database. The DB read
uses an in-memory sqlite.
"""

import sqlite3
import unittest
from datetime import datetime, timedelta

from export_helpers import (
    MARKET_NOT_COLLECTED_REASON,
    build_comparisons_for_route,
    build_itinerary_for_date,
    load_provider_status_for_routes,
)


class TestBuildItineraryForDate(unittest.TestCase):
    """The Itinerary shape that goes on every CheapDate row."""

    def _fresh_scan_time(self) -> str:
        return (datetime.now() - timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S")

    def _stale_scan_time(self) -> str:
        return (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d %H:%M:%S")

    def _detail_row(self) -> dict:
        return {
            "outbound_airline": "UO",
            "outbound_flight": "260",
            "outbound_dep_time": "22:05",
            "outbound_arr_time": "01:35",
            "return_airline": "UO",
            "return_flight": "261",
            "return_dep_time": "02:35",
            "return_arr_time": "06:35",
        }

    def test_no_detail_row_returns_not_collected(self):
        it = build_itinerary_for_date(
            dep_date="2026-09-01",
            ret_date="2026-09-08",
            detail_row=None,
            last_verified=None,
            provider_status=None,
        )
        self.assertEqual(it["status"], "not_collected")
        self.assertEqual(it["source"], "flight_dates_fallback")
        self.assertIsNone(it["scannedAt"])
        self.assertNotIn("outbound", it)
        self.assertNotIn("return", it)
        self.assertEqual(it["retDate"], "2026-09-08")

    def test_provider_blocked_returns_not_collected(self):
        it = build_itinerary_for_date(
            dep_date="2026-09-01",
            ret_date="2026-09-08",
            detail_row=self._detail_row(),
            last_verified=self._fresh_scan_time(),
            provider_status="blocked",
        )
        # Even though we have data, the provider marked it unsafe.
        self.assertEqual(it["status"], "not_collected")
        self.assertIsNone(it["source"])
        # scannedAt preserved for operator logs.
        self.assertIsNotNone(it["scannedAt"])

    def test_provider_denied_returns_not_collected(self):
        it = build_itinerary_for_date(
            dep_date="2026-09-01",
            ret_date="2026-09-08",
            detail_row=self._detail_row(),
            last_verified=self._fresh_scan_time(),
            provider_status="denied",
        )
        self.assertEqual(it["status"], "not_collected")

    def test_provider_schema_changed_returns_not_collected(self):
        it = build_itinerary_for_date(
            dep_date="2026-09-01",
            ret_date="2026-09-08",
            detail_row=self._detail_row(),
            last_verified=self._fresh_scan_time(),
            provider_status="schema_changed",
        )
        self.assertEqual(it["status"], "not_collected")

    def test_fresh_detail_row_returns_selected(self):
        it = build_itinerary_for_date(
            dep_date="2026-09-01",
            ret_date="2026-09-08",
            detail_row=self._detail_row(),
            last_verified=self._fresh_scan_time(),
            provider_status="ok",
        )
        self.assertEqual(it["status"], "selected")
        self.assertEqual(it["source"], "flight_details")
        self.assertIsNotNone(it["scannedAt"])
        # Full outbound + return with all fields.
        self.assertEqual(it["outbound"]["airline"], "UO")
        self.assertEqual(it["outbound"]["flight"], "260")
        self.assertEqual(it["outbound"]["depTime"], "22:05")
        self.assertEqual(it["outbound"]["arrTime"], "01:35")
        self.assertEqual(it["return"]["airline"], "UO")
        self.assertEqual(it["return"]["flight"], "261")

    def test_stale_detail_row_returns_stale(self):
        it = build_itinerary_for_date(
            dep_date="2026-09-01",
            ret_date="2026-09-08",
            detail_row=self._detail_row(),
            last_verified=self._stale_scan_time(),
            provider_status="ok",
            detail_max_age_hours=24,
        )
        self.assertEqual(it["status"], "stale")
        self.assertEqual(it["source"], "flight_details")
        self.assertIsNotNone(it["scannedAt"])

    def test_missing_scan_time_with_detail_row_is_stale(self):
        # detail_row exists, provider_status='ok', but last_verified is None.
        # Conservative: stale (we have data, just no idea when it was written).
        it = build_itinerary_for_date(
            dep_date="2026-09-01",
            ret_date="2026-09-08",
            detail_row=self._detail_row(),
            last_verified=None,
            provider_status="ok",
        )
        self.assertEqual(it["status"], "stale")

    def test_ret_date_preserved(self):
        # Even on not_collected, retDate must be present so the UI can
        # compute the stay length without re-parsing.
        it = build_itinerary_for_date(
            dep_date="2026-09-01",
            ret_date="2026-09-15",
            detail_row=None,
            last_verified=None,
            provider_status=None,
        )
        self.assertEqual(it["retDate"], "2026-09-15")


class TestBuildComparisonsForRoute(unittest.TestCase):
    """Wraps deal_confidence; should expose all 3 comparison blocks."""

    def _entry(self, price: int, stay: int = 7) -> dict:
        return {"price": price, "stay": stay}

    def test_returns_three_blocks(self):
        candidate = self._entry(9000)
        context = [
            self._entry(8200), self._entry(8500), self._entry(9000),
            self._entry(9800), self._entry(10500), self._entry(11200),
        ]
        history = [9050, 8950]  # past prices for the same pair

        result = build_comparisons_for_route(
            route="HKG→BKK",
            candidate_entry=candidate,
            route_date_context=context,
            pair_history=history,
        )

        self.assertIn("dateComparison", result)
        self.assertIn("historyComparison", result)
        self.assertIn("marketComparison", result)

    def test_date_comparison_uses_7day_stay_pool(self):
        # Only peers with stay=7 participate in dateComparison.
        candidate = self._entry(9000, stay=7)
        context = [
            self._entry(8200, stay=7),  # same-stay peer
            self._entry(11500, stay=14),  # different-stay peer
            self._entry(12500, stay=14),
            self._entry(13500, stay=21),
        ]
        result = build_comparisons_for_route(
            route="HKG→BKK",
            candidate_entry=candidate,
            route_date_context=context,
            pair_history=[],
        )
        dc = result["dateComparison"]
        # Only 1 same-stay peer → status='insufficient_data' per spec
        # (MIN_DATE_PEERS=3 in deal_confidence).
        self.assertEqual(dc["status"], "insufficient_data")
        self.assertEqual(dc["sampleSize"], 1)

    def test_date_comparison_ready_with_three_peers(self):
        # Add 2 more same-stay peers → status='ready'.
        candidate = self._entry(9000, stay=7)
        context = [
            self._entry(8200, stay=7),
            self._entry(8500, stay=7),
            self._entry(9500, stay=7),
        ]
        result = build_comparisons_for_route(
            route="HKG→BKK",
            candidate_entry=candidate,
            route_date_context=context,
            pair_history=[],
        )
        dc = result["dateComparison"]
        self.assertEqual(dc["status"], "ready")
        self.assertEqual(dc["sampleSize"], 3)

    def test_market_comparison_always_not_collected(self):
        # Until a current authorized detail source confirms the market,
        # marketComparison must stay not_collected with the canonical
        # reason string (R7 from the incident review).
        result = build_comparisons_for_route(
            route="HKG→BKK",
            candidate_entry=self._entry(9000),
            route_date_context=[self._entry(8200)] * 5,
            pair_history=[9050, 8950],
        )
        mc = result["marketComparison"]
        self.assertEqual(mc["status"], "not_collected")
        self.assertEqual(mc["reason"], MARKET_NOT_COLLECTED_REASON)
        self.assertEqual(mc["reason"], "requires_all_comparable_itineraries")


class TestLoadProviderStatusForRoutes(unittest.TestCase):
    """Loads provider_status for recent flight_details rows."""

    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.execute("""
            CREATE TABLE flight_details (
                route TEXT NOT NULL,
                dep_date TEXT NOT NULL,
                ret_date TEXT NOT NULL,
                scan_time TEXT NOT NULL,
                provider_status TEXT NOT NULL DEFAULT 'ok',
                departure TEXT NOT NULL
            )
        """)

    def tearDown(self):
        self.conn.close()

    def test_loads_blocked_rows_only(self):
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        old = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d %H:%M:%S")
        self.conn.executemany(
            "INSERT INTO flight_details VALUES (?, ?, ?, ?, ?, ?)",
            [
                ("HKG→BKK", "2026-09-01", "2026-09-08", now, "ok", "HKG"),
                ("HKG→BKK", "2026-09-02", "2026-09-09", now, "blocked", "HKG"),
                ("HKG→NRT", "2026-10-01", "2026-10-08", now, "denied", "HKG"),
                ("HKG→BKK", "2026-08-01", "2026-08-08", old, "blocked", "HKG"),
                ("SZX→BKK", "2026-09-01", "2026-09-08", now, "blocked", "SZX"),
            ],
        )
        self.conn.commit()

        result = load_provider_status_for_routes(self.conn, departure="HKG")
        # Only HKG-departing recent blocked/denied rows.
        self.assertEqual(len(result), 2)
        self.assertEqual(
            result[("HKG→BKK", "2026-09-02", "2026-09-09")], "blocked"
        )
        self.assertEqual(
            result[("HKG→NRT", "2026-10-01", "2026-10-08")], "denied"
        )
        # 'ok' rows are NOT in the result.
        self.assertNotIn(("HKG→BKK", "2026-09-01", "2026-09-08"), result)
        # Old blocked row beyond max_age is NOT in the result.
        self.assertNotIn(("HKG→BKK", "2026-08-01", "2026-08-08"), result)
        # SZX rows are NOT in the result.
        self.assertNotIn(("SZX→BKK", "2026-09-01", "2026-09-08"), result)

    def test_empty_when_no_blocked_rows(self):
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.conn.execute(
            "INSERT INTO flight_details VALUES (?, ?, ?, ?, ?, ?)",
            ("HKG→BKK", "2026-09-01", "2026-09-08", now, "ok", "HKG"),
        )
        self.conn.commit()

        result = load_provider_status_for_routes(self.conn, departure="HKG")
        self.assertEqual(result, {})


if __name__ == "__main__":
    unittest.main()
