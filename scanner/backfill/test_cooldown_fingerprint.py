"""Smoke test: backfill_cooldown_fingerprint on a fixture, verify output shape."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from cooldown_fingerprint import backfill  # type: ignore


def make_all_dates():
    return {
        "results": [
            {"destination": {"code": "HIJ"}, "typicalPrice": 3283, "cheapestDates": [{"price": 2029}]},
            {"destination": {"code": "NGO"}, "typicalPrice": 2500, "cheapestDates": [{"price": 1800}]},
        ],
        "uoDrops": [
            {"destination": {"code": "HIJ"}, "typicalPrice": 2785},
        ],
    }


def make_cooldown():
    return {
        "HKG→UO→廣島 (HIJ)": {"amount": None, "pct": None, "price": None, "ts": "2026-09-29T00:00:05+08:00"},
        "HKG→NGO": {"amount": -700, "pct": -28.0, "price": 1800.0, "ts": "2026-09-29T00:00:05+08:00"},
        "HKG→BARE": "2026-09-28T00:00:05+08:00",  # legacy string entry, skip
    }


def test_fills_null_entries():
    cooldown = make_cooldown()
    all_dates = make_all_dates()
    filled, skipped = backfill(cooldown, all_dates)
    assert filled == 1, f"should fill HIJ, got {filled}"
    assert skipped == 2, f"should skip NGO (already has fingerprint) + BARE (string), got {skipped}"
    cd = cooldown["HKG→UO→廣島 (HIJ)"]
    assert cd["amount"] == -1254, f"expected -1254, got {cd['amount']}"
    assert cd["pct"] == -38.2, f"expected -38.2, got {cd['pct']}"
    assert cd["price"] == 2029.0


def test_skips_legacy_string_entries():
    cooldown = {"HKG→HIJ": "2026-09-29T00:00:05+08:00"}
    all_dates = make_all_dates()
    filled, skipped = backfill(cooldown, all_dates)
    assert filled == 0
    assert skipped == 1
    # Original string entry untouched
    assert cooldown["HKG→HIJ"] == "2026-09-29T00:00:05+08:00"


def test_handles_missing_destination():
    cooldown = {"HKG→XYZ (XYZ)": {"amount": None, "pct": None, "price": None, "ts": "2026-09-29T00:00:05+08:00"}}
    all_dates = make_all_dates()
    filled, skipped = backfill(cooldown, all_dates)
    assert filled == 0
    assert skipped == 1


def test_handles_no_drop():
    """typicalPrice ≤ newPrice means no drop — entry stays ts-only."""
    cooldown = {"HKG→HIJ": {"amount": None, "pct": None, "price": None, "ts": "2026-09-29T00:00:05+08:00"}}
    all_dates = {
        "results": [
            {"destination": {"code": "HIJ"}, "typicalPrice": 1500, "cheapestDates": [{"price": 2000}]},
        ],
    }
    filled, skipped = backfill(cooldown, all_dates)
    assert filled == 0
    assert skipped == 1
    # Amount still null
    assert cooldown["HKG→HIJ"]["amount"] is None


if __name__ == "__main__":
    test_fills_null_entries()
    test_skips_legacy_string_entries()
    test_handles_missing_destination()
    test_handles_no_drop()
    print("All tests passed")
