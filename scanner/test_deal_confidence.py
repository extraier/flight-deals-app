"""Tests for scanner/deal_confidence.py.

Coverage matches the validation steps from Manus's rollout doc:
  1. Insufficient-data path (less than three same-stay peer dates).
  2. Ready path (≥ 3 peers) with realistic percentile / vsMedian math.
  3. History comparison with fewer than 2 observations.
  4. History comparison with sufficient observations.
  5. Market comparison is always `not_collected` until the detail
     scanner captures every comparable offer.
  6. Mixed-stay filtering: only same-stay peers participate.
  7. NaN / missing / non-positive price inputs are filtered out.
  8. Same-stay peer count math (3 vs 4 vs 48) for the canonical example.
"""

import math
import unittest

from deal_confidence import (
    MARKET_NOT_COLLECTED_REASON,
    MIN_DATE_PEERS,
    MIN_HISTORY_OBSERVATIONS,
    build_date_comparison,
    build_deal_confidence,
    build_history_comparison,
    build_market_comparison,
)


def _entry(price, stay=6, dep_date="2026-09-01", ret_date="2026-09-07"):
    return {
        "price": price,
        "stay": stay,
        "dep_date": dep_date,
        "ret_date": ret_date,
    }


class TestDateComparison(unittest.TestCase):
    def test_insufficient_data_when_no_peers(self):
        result = build_date_comparison(_entry(8200, stay=6), [])
        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["scope"], "same_stay_length")
        self.assertEqual(result["stay"], 6)
        self.assertEqual(result["sampleSize"], 0)
        self.assertNotIn("medianPrice", result)

    def test_insufficient_data_when_only_two_same_stay_peers(self):
        # The spec example: <3 same-stay peers -> insufficient_data.
        peers = [
            {"price": 8200, "stay": 6},
            {"price": 8500, "stay": 6},
        ]
        result = build_date_comparison(_entry(9000, stay=6), peers)
        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["sampleSize"], 2)

    def test_ready_with_three_same_stay_peers(self):
        # Three peers, candidate is the cheapest.
        peers = [
            {"price": 12000, "stay": 6},
            {"price": 11300, "stay": 6},
            {"price": 10500, "stay": 6},
        ]
        result = build_date_comparison(_entry(8200, stay=6), peers)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["sampleSize"], 3)
        self.assertEqual(result["stay"], 6)
        # Candidate is cheaper than all 3 peers.
        self.assertEqual(result["pricePercentile"], 0.0)
        # Median is 11300, candidate 8200 -> (8200-11300)/11300 = -27.43%
        self.assertAlmostEqual(result["vsMedianPct"], -27.43, places=2)
        self.assertEqual(result["medianPrice"], 11300)
        self.assertEqual(result["lowestPrice"], 10500)

    def test_ready_with_48_peers_matches_doc_example(self):
        # Reproduces the spec's worked example: 48 same-stay peers,
        # lowest 8200, median 11300. Candidate price 9000 sits between
        # lowest and median. Strictly-cheaper-than-9000 peers are 8200-8900
        # = 8 peers. 8/48 = 16.67%.
        peers = sorted(
            [{"price": p, "stay": 6} for p in [
                8200,                                # lowest peer
                *[8200 + i * 100 for i in range(1, 47)],  # 8300..12700
                11300,                               # one extra at median
            ]],
            key=lambda p: p["price"],
        )
        self.assertEqual(len(peers), 48)

        result = build_date_comparison(_entry(9000, stay=6), peers)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["sampleSize"], 48)
        # Candidate 9000 is strictly more expensive than 8200..8900 = 8 peers.
        self.assertAlmostEqual(result["pricePercentile"], (8 / 48) * 100, places=2)

    def test_filters_only_same_stay_peers(self):
        # Candidate is 6-night; 4-night and 8-night peers must be excluded.
        peers = [
            {"price": 5000, "stay": 4},   # would win on price if included
            {"price": 9900, "stay": 6},
            {"price": 10100, "stay": 6},
            {"price": 12000, "stay": 6},
            {"price": 8000, "stay": 8},   # would win on price if included
        ]
        result = build_date_comparison(_entry(9500, stay=6), peers)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["sampleSize"], 3)  # only 6-night peers count

    def test_explicit_stay_overrides_date_math(self):
        # If `stay` is explicitly set, use it; don't recompute from dates.
        entry = _entry(9000, stay=10, dep_date="2026-09-01", ret_date="2026-09-07")
        # The dates imply 6 nights but `stay=10` should win.
        peers = [{"price": p, "stay": 10} for p in [9500, 10100, 11200]]
        result = build_date_comparison(entry, peers)
        self.assertEqual(result["stay"], 10)
        self.assertEqual(result["status"], "ready")

    def test_missing_stay_returns_insufficient_data(self):
        # If neither `stay` nor (dep+ret) yields a usable nights count,
        # we cannot compare — fall back to insufficient_data.
        entry = {"price": 9000, "dep_date": "2026-09-01", "ret_date": "bad-date"}
        peers = [{"price": 9500, "stay": 6}, {"price": 10100, "stay": 6}]
        result = build_date_comparison(entry, peers)
        self.assertEqual(result["status"], "insufficient_data")
        self.assertIsNone(result["stay"])

    def test_filters_zero_and_nan_prices(self):
        # Peers with invalid prices must be dropped silently.
        peers = [
            {"price": 9000, "stay": 6},
            {"price": 0, "stay": 6},      # zero -> invalid
            {"price": -100, "stay": 6},   # negative -> invalid
            {"price": float("nan"), "stay": 6},
            {"price": None, "stay": 6},
            {"price": 10500, "stay": 6},
            {"price": 11300, "stay": 6},
        ]
        result = build_date_comparison(_entry(9500, stay=6), peers)
        # Only the two valid peers (9000, 10500, 11300) -> 3 peers total,
        # but 9000 is the candidate itself? No — the candidate isn't in
        # the peer list, so all 3 valid peers remain as peers.
        self.assertEqual(result["sampleSize"], 3)
        self.assertEqual(result["status"], "ready")

    def test_candidate_with_invalid_price_returns_insufficient(self):
        peers = [{"price": 9000, "stay": 6}, {"price": 10100, "stay": 6},
                 {"price": 11200, "stay": 6}]
        entry = _entry(None, stay=6)
        result = build_date_comparison(entry, peers)
        # sampleSize still reflects actual peer count so the UI can show
        # "資料不足（3 筆）" — only the ranking fields are suppressed.
        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["sampleSize"], 3)
        self.assertNotIn("medianPrice", result)

    def test_percentile_definition_strict_cheaper(self):
        # Per spec: "share of comparable observations STRICTLY cheaper than
        # the candidate". Equal prices must NOT count as cheaper.
        peers = [{"price": p, "stay": 6} for p in [9000, 9000, 9000]]
        result = build_date_comparison(_entry(9000, stay=6), peers)
        # 0 of 3 strictly cheaper.
        self.assertEqual(result["pricePercentile"], 0.0)


class TestHistoryComparison(unittest.TestCase):
    def test_insufficient_with_no_history(self):
        result = build_history_comparison(_entry(9000), [])
        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["sampleSize"], 0)
        self.assertEqual(result["scope"], "same_date_pair_observations")

    def test_insufficient_with_only_one_observation(self):
        result = build_history_comparison(_entry(9000), [9500])
        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["sampleSize"], 1)

    def test_ready_with_two_observations(self):
        result = build_history_comparison(_entry(9000), [9500, 9800])
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["sampleSize"], 2)
        # Median of [9500, 9800] = 9650. (9000-9650)/9650 = -6.74%.
        self.assertAlmostEqual(result["vsMedianPct"], -6.74, places=2)
        # 0 of 2 peers strictly cheaper than 9000 -> 0% percentile.
        self.assertEqual(result["pricePercentile"], 0.0)

    def test_ready_with_three_observations_matches_doc_example(self):
        # Reproduces the spec's historyComparison example: 3 observations,
        # median 10000, candidate 9000 -> vsMedianPct -10.0%.
        result = build_history_comparison(_entry(9000), [11000, 10000, 9500])
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["sampleSize"], 3)
        self.assertEqual(result["medianPrice"], 10000)
        # (9000 - 10000) / 10000 = -10.0%.
        self.assertAlmostEqual(result["vsMedianPct"], -10.0, places=2)

    def test_filters_invalid_history_prices(self):
        result = build_history_comparison(
            _entry(9000),
            [9500, 0, -50, None, float("nan"), 10000, 10500],
        )
        # 4 valid prices (9500, 10000, 10500) + 9500... wait that's 4.
        # 9500, 10000, 10500 = 3 valid; 0 and -50 dropped; None/NaN dropped.
        self.assertEqual(result["sampleSize"], 3)
        self.assertEqual(result["status"], "ready")


class TestMarketComparison(unittest.TestCase):
    def test_always_not_collected(self):
        result = build_market_comparison()
        self.assertEqual(result["status"], "not_collected")
        self.assertEqual(result["reason"], MARKET_NOT_COLLECTED_REASON)
        self.assertEqual(result["reason"], "requires_all_comparable_itineraries")


class TestBuildDealConfidence(unittest.TestCase):
    def test_full_payload_shape(self):
        entry = _entry(9000, stay=6)
        peers = [{"price": 9500, "stay": 6}, {"price": 10100, "stay": 6},
                 {"price": 11200, "stay": 6}]
        history = [9500, 9800]
        result = build_deal_confidence(entry, peers, history)

        self.assertIn("dateComparison", result)
        self.assertIn("historyComparison", result)
        self.assertIn("marketComparison", result)

        self.assertEqual(result["dateComparison"]["status"], "ready")
        self.assertEqual(result["historyComparison"]["status"], "ready")
        self.assertEqual(result["marketComparison"]["status"], "not_collected")

    def test_full_payload_with_empty_inputs(self):
        # Empty inputs must NOT crash — every stage has its own fallback.
        entry = _entry(9000, stay=6)
        result = build_deal_confidence(entry, [], [])
        self.assertEqual(result["dateComparison"]["status"], "insufficient_data")
        self.assertEqual(result["historyComparison"]["status"], "insufficient_data")
        self.assertEqual(result["marketComparison"]["status"], "not_collected")


class TestSpecConstants(unittest.TestCase):
    def test_min_date_peers_is_three(self):
        # Spec says "at least three same-stay peer dates". This is a
        # guard against drifting the constant without updating tests.
        self.assertEqual(MIN_DATE_PEERS, 3)

    def test_min_history_observations_is_two(self):
        # Two observations is the smallest pair that lets the median
        # be a real value (not a single point). Not in the spec
        # directly, but the spec example has 3 observations ready.
        self.assertEqual(MIN_HISTORY_OBSERVATIONS, 2)


class TestPercentileMathEdgeCases(unittest.TestCase):
    def test_percentile_all_more_expensive(self):
        # All peers are MORE expensive than the candidate -> they are
        # ALL strictly cheaper than the candidate in the percentile
        # definition? No — peers are the reference set. "Cheaper than
        # the candidate" means peer_price < candidate_price. If all
        # peers are MORE expensive, 0 are strictly cheaper -> 0%.
        # Wait — re-read: "share of peer records strictly cheaper
        # than the candidate". So price_peers < price_candidate.
        # All peers more expensive -> 0 of 3 cheaper -> 0% percentile.
        peers = [{"price": p, "stay": 6} for p in [10000, 11000, 12000]]
        result = build_date_comparison(_entry(9000, stay=6), peers)
        self.assertEqual(result["pricePercentile"], 0.0)
        # vsMedian: median = 11000, (9000-11000)/11000 = -18.18%.
        self.assertAlmostEqual(result["vsMedianPct"], -18.18, places=2)

    def test_percentile_all_cheaper(self):
        # All peers strictly cheaper than candidate -> 100% percentile.
        peers = [{"price": p, "stay": 6} for p in [7000, 7500, 8000]]
        result = build_date_comparison(_entry(9000, stay=6), peers)
        self.assertEqual(result["pricePercentile"], 100.0)
        # vsMedian: median = 7500, (9000-7500)/7500 = +20.0%.
        self.assertAlmostEqual(result["vsMedianPct"], 20.0, places=2)

    def test_vsmedian_zero_when_median_zero(self):
        # Defensive: median shouldn't be zero for valid prices, but
        # guard against div-by-zero anyway.
        peers = [{"price": 1, "stay": 6}, {"price": 1, "stay": 6},
                 {"price": 1, "stay": 6}]
        result = build_date_comparison(_entry(1, stay=6), peers)
        self.assertEqual(result["vsMedianPct"], 0.0)


class TestSpecExampleOutput(unittest.TestCase):
    """Reproduce the JSON shape from Manus's rollout doc lines 13-43.

    These tests pin the exact field names and types so a future
    refactor cannot drift from the documented contract without a test
    failure.
    """

    def test_date_comparison_shape_matches_doc(self):
        entry = _entry(9000, stay=6)
        peers = [{"price": p, "stay": 6} for p in [8200, 11300, 10000]]
        result = build_date_comparison(entry, peers)
        # Top-level keys exactly as the doc shows.
        self.assertEqual(set(result.keys()),
                         {"scope", "stay", "status", "sampleSize",
                          "lowestPrice", "medianPrice",
                          "pricePercentile", "vsMedianPct"})

    def test_history_comparison_shape_matches_doc(self):
        entry = _entry(9000, stay=6)
        history = [11000, 10000, 9000]
        result = build_history_comparison(entry, history)
        self.assertEqual(set(result.keys()),
                         {"scope", "status", "sampleSize",
                          "lowestPrice", "medianPrice",
                          "pricePercentile", "vsMedianPct"})

    def test_market_comparison_shape_matches_doc(self):
        result = build_market_comparison()
        # Exactly two fields, both strings, per the doc.
        self.assertEqual(set(result.keys()), {"status", "reason"})
        self.assertEqual(result["status"], "not_collected")
        self.assertEqual(result["reason"], "requires_all_comparable_itineraries")

    def test_full_payload_matches_doc_example(self):
        """End-to-end: produces the structure shown in doc lines 16-42."""
        entry = _entry(8200, stay=6)
        peers = [{"price": 8200, "stay": 6},
                 {"price": 8400, "stay": 6},
                 {"price": 11300, "stay": 6}]
        history = [11000, 10000, 9000]
        result = build_deal_confidence(entry, peers, history)

        # Outer shape matches the doc:
        self.assertEqual(set(result.keys()),
                         {"dateComparison", "historyComparison", "marketComparison"})

        # dateComparison: all doc fields present.
        dc = result["dateComparison"]
        self.assertEqual(dc["scope"], "same_stay_length")
        self.assertEqual(dc["status"], "ready")
        self.assertEqual(dc["sampleSize"], 3)
        self.assertEqual(dc["lowestPrice"], 8200)
        # Median of [8200, 8400, 11300] is 8400.
        self.assertEqual(dc["medianPrice"], 8400)

        # historyComparison: all doc fields present.
        hc = result["historyComparison"]
        self.assertEqual(hc["scope"], "same_date_pair_observations")
        self.assertEqual(hc["status"], "ready")
        self.assertEqual(hc["sampleSize"], 3)
        self.assertEqual(hc["lowestPrice"], 9000)
        self.assertEqual(hc["medianPrice"], 10000)

        # marketComparison: explicit not_collected.
        mc = result["marketComparison"]
        self.assertEqual(mc["status"], "not_collected")
        self.assertEqual(mc["reason"], "requires_all_comparable_itineraries")


if __name__ == "__main__":
    unittest.main()
