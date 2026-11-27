"""Departure year rollover for Google Flights digests."""
import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from gflights_poller import (  # noqa: E402
    alert_reference,
    departure_has_passed,
    flatten_for_api,
    rolled_departure_date,
)

NOV_15 = int(datetime(2026, 11, 15, 2, 0, tzinfo=timezone.utc).timestamp() * 1000)
OCT_20 = int(datetime(2026, 10, 20, 2, 0, tzinfo=timezone.utc).timestamp() * 1000)
NOW = datetime(2026, 11, 26, 4, 0, tzinfo=timezone.utc)


class YearRolloverTest(unittest.TestCase):
    def test_jan_and_may_emailed_in_autumn_are_next_year(self):
        nov = alert_reference(alert_unix_ms=NOV_15)
        oct_ = alert_reference(alert_unix_ms=OCT_20)
        self.assertEqual(rolled_departure_date("Jan", 28, nov), "2027-01-28")
        self.assertEqual(rolled_departure_date("May", 4, oct_), "2027-05-04")

    def test_same_month_keeps_the_email_year_and_past_dates_drop(self):
        nov = alert_reference(alert_unix_ms=NOV_15)
        self.assertEqual(rolled_departure_date("Dec", 20, nov), "2026-12-20")
        self.assertFalse(departure_has_passed("2026-12-20", now=NOW))
        self.assertTrue(departure_has_passed("2026-11-01", now=NOW))

    def test_flatten_keeps_the_link_and_skips_a_past_departure(self):
        parsed = {
            "origin": "Hong Kong",
            "destination": "Los Angeles",
            "prices_updated": "2026-11-15",
            "parsed_at": "2026-11-15T02:00:00+00:00",
            "deals": [
                {"dep_month": "Jan", "dep_day": 28, "date_range": "Thu, Jan 28 – Thu, Feb 4",
                 "price": 4000, "view_link": "https://c.gle/example-jan"},
                {"dep_month": "Nov", "dep_day": 1, "date_range": "Sun, Nov 1 – Sun, Nov 8",
                 "price": 3000, "view_link": "https://c.gle/example-past"},
            ],
        }
        flat = flatten_for_api(
            parsed, message_id="m1", alert_date_iso="2026-11-15T02:00:00+00:00",
            alert_unix_ms=NOV_15,
        )
        # departure_has_passed uses datetime.now(), so pin via the helper
        # and only assert the year on the January row when it is kept.
        dates = {row["dep_date"]: row["view_link"] for row in flat}
        self.assertIn("2027-01-28", dates)
        self.assertEqual(dates["2027-01-28"], "https://c.gle/example-jan")
        self.assertNotIn("2026-01-28", dates)


if __name__ == "__main__":
    unittest.main()
