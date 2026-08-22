#!/usr/bin/env python3
"""
Tests for send_flight_report.py — focus on the phantom-repeat detection
that was added 2026-08-15 (Bug C).

Run from the repo root:
    python3 -m scanner.test_send_flight_report
or:
    cd scanner && python3 test_send_flight_report.py

What this covers:

  * is_phantom_repeat() — fingerprint matching with tolerance
  * filter_already_alerted() — combined 6h time-window + phantom check
  * migrate_legacy_cooldown() — backwards-compat for old plain-string entries
  * mark_alerted() — new stamped format + GC of expired entries

What this does NOT cover:

  * The Telegram send_telegram() function (needs live bot token)
  * The /api/deals fetch path (needs live Vercel)
  * The legacy plain-string cooldown shape (covered indirectly via
    migrate_legacy_cooldown)
"""
import sys
import os
import datetime as dt
import tempfile
import shutil
from pathlib import Path

# Make the parent (scanner/) importable when run from anywhere
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import send_flight_report as sfr


def _now_hk():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=8)))


def _ago(hours):
    return (_now_hk() - dt.timedelta(hours=hours)).isoformat()


# ─── is_phantom_repeat ──────────────────────────────────────────────

def test_phantom_detects_matching_fingerprint():
    """Same (price, amount) within tolerance → phantom."""
    old_entry = {"ts": _ago(1), "price": 1278, "pct": -11.1, "amount": -160}
    new_drop = {"price": 1278, "drop_pct": -11.1, "drop_amount": -160}
    assert sfr.is_phantom_repeat(new_drop, old_entry) is True
    print("  ✓ test_phantom_detects_matching_fingerprint")


def test_phantom_allows_real_new_drop():
    """Different price → not a phantom."""
    old_entry = {"ts": _ago(1), "price": 1278, "pct": -11.1, "amount": -160}
    new_drop = {"price": 1100, "drop_pct": -21.0, "drop_amount": -338}
    assert sfr.is_phantom_repeat(new_drop, old_entry) is False
    print("  ✓ test_phantom_allows_real_new_drop")


def test_phantom_tolerates_exporter_rounding():
    """$1 HKD rounding on price + amount is tolerated."""
    old_entry = {"ts": _ago(1), "price": 1278, "pct": -11.1, "amount": -160}
    new_drop = {"price": 1279, "drop_pct": -10.95, "drop_amount": -159}
    assert sfr.is_phantom_repeat(new_drop, old_entry) is True
    print("  ✓ test_phantom_tolerates_exporter_rounding")


def test_phantom_legacy_entry_never_triggers():
    """Old plain-string cooldown entries (no fingerprint) can't trigger."""
    new_drop = {"price": 1278, "drop_pct": -11.1, "drop_amount": -160}
    assert sfr.is_phantom_repeat(new_drop, "2026-08-15T00:00:00+08:00") is False
    print("  ✓ test_phantom_legacy_entry_never_triggers")


def test_phantom_no_fingerprint_stored():
    """Migrated legacy (dict with price=None) doesn't trigger."""
    old_entry = {"ts": _ago(1), "price": None, "pct": None, "amount": None}
    new_drop = {"price": 1278, "drop_pct": -11.1, "drop_amount": -160}
    assert sfr.is_phantom_repeat(new_drop, old_entry) is False
    print("  ✓ test_phantom_no_fingerprint_stored")


# ─── filter_already_alerted ─────────────────────────────────────────

def test_filter_suppresses_within_6h():
    """Time-window dedup: same route alerted 2h ago is suppressed."""
    fresh = [{"price": 1100, "drop_pct": -21, "drop_amount": -338,
              "route_key": "HKG→台北 (TPE)"}]
    cooldown = {"HKG→台北 (TPE)": {"ts": _ago(2), "price": 2000, "pct": -50, "amount": -1000}}
    out = sfr.filter_already_alerted(fresh, cooldown)
    assert len(out) == 0, f"Expected suppress, got {len(out)}"
    print("  ✓ test_filter_suppresses_within_6h")


def test_filter_suppresses_phantom_after_6h():
    """Phantom: same price tuple 10h after alert is still suppressed."""
    fresh = [{"price": 1278, "drop_pct": -11.1, "drop_amount": -160,
              "route_key": "HKG→台北 (TPE)"}]
    cooldown = {"HKG→台北 (TPE)": {"ts": _ago(10), "price": 1278, "pct": -11.1, "amount": -160}}
    out = sfr.filter_already_alerted(fresh, cooldown)
    assert len(out) == 0, f"Expected phantom suppress, got {len(out)}"
    print("  ✓ test_filter_suppresses_phantom_after_6h")


def test_filter_allows_genuine_new_drop_after_6h():
    """Real new drop with different price passes after the dedup window.

    Hermes 2026-08-22 (CI alerter regression): COOLDOWN_DEDUP_WINDOW was
    widened 6h→24h on 2026-08-17 (Bug D), but this test's fixture still
    used _ago(10). At that age, the cooldown entry is still within the 24h
    window and gets suppressed — the test only passes when the fixture's
    "now" is more than 24h after the CI clock's "now" (intermittent fail).
    Use _ago(25) so the entry is reliably outside the window.
    """
    fresh = [{"price": 1100, "drop_pct": -21, "drop_amount": -338,
              "route_key": "HKG→台北 (TPE)"}]
    cooldown = {"HKG→台北 (TPE)": {"ts": _ago(25), "price": 1278, "pct": -11.1, "amount": -160}}
    out = sfr.filter_already_alerted(fresh, cooldown)
    assert len(out) == 1, f"Expected pass, got {len(out)}"
    assert out[0]["price"] == 1100
    print("  ✓ test_filter_allows_genuine_new_drop_after_6h")


def test_filter_passes_unseen_route():
    """First-time alert is never suppressed."""
    fresh = [{"price": 1500, "drop_pct": -5, "drop_amount": -80,
              "route_key": "HKG→新航線"}]
    cooldown = {}
    out = sfr.filter_already_alerted(fresh, cooldown)
    assert len(out) == 1
    print("  ✓ test_filter_passes_unseen_route")


def test_filter_mixed_phantom_and_real():
    """Two candidates: one phantom, one real. Only the real one passes.

    Hermes 2026-08-22 (CI alerter regression): NRT cooldown used
    _ago(20). After Bug D widened the dedup window 6h→24h, NRT (20h
    old) is still within the window and gets suppressed — only the
    phantom case survives, both entries get filtered. Move NRT to
    _ago(25) so it's reliably outside the 24h window.
    """
    fresh = [
        {"price": 1278, "drop_pct": -11.1, "drop_amount": -160,
         "route_key": "HKG→台北 (TPE)"},       # phantom (matches TPE entry)
        {"price": 1100, "drop_pct": -21, "drop_amount": -338,
         "route_key": "HKG→東京 (NRT)"},       # real new drop
    ]
    cooldown = {
        "HKG→台北 (TPE)": {"ts": _ago(8), "price": 1278, "pct": -11.1, "amount": -160},
        "HKG→東京 (NRT)": {"ts": _ago(25), "price": 1500, "pct": -3, "amount": -50},
    }
    out = sfr.filter_already_alerted(fresh, cooldown)
    assert len(out) == 1
    assert out[0]["route_key"] == "HKG→東京 (NRT)"
    print("  ✓ test_filter_mixed_phantom_and_real")


# ─── migrate_legacy_cooldown ─────────────────────────────────────────

def test_migrate_legacy_to_stamped():
    """Plain-string entries become dicts with None fingerprint."""
    cooldown = {
        "A→B": "2026-08-15T00:00:00+08:00",
        "C→D": {"ts": "2026-08-15T01:00:00+08:00", "price": 500, "pct": -10, "amount": -50},
    }
    tmpdir = tempfile.mkdtemp()
    orig_path = sfr.COOLDOWN_PATH
    sfr.COOLDOWN_PATH = os.path.join(tmpdir, "cooldown.json")
    try:
        out = sfr.migrate_legacy_cooldown(cooldown)
        assert isinstance(out["A→B"], dict)
        assert out["A→B"]["ts"] == "2026-08-15T00:00:00+08:00"
        assert out["A→B"]["price"] is None
        # Already-stamped entry is preserved unchanged
        assert out["C→D"] == cooldown["C→D"]
        # Idempotent: re-migrating produces same shape
        out2 = sfr.migrate_legacy_cooldown(out)
        assert out2 == out
    finally:
        sfr.COOLDOWN_PATH = orig_path
        shutil.rmtree(tmpdir)
    print("  ✓ test_migrate_legacy_to_stamped")


# ─── mark_alerted ────────────────────────────────────────────────────

def test_mark_alerted_with_payload_creates_dict():
    """When alert_payload is provided, stamped dict is stored."""
    cooldown = {}
    payload = {"HKG→台北 (TPE)": {"price": 1278, "drop_pct": -11.1, "drop_amount": -160}}
    out = sfr.mark_alerted(["HKG→台北 (TPE)"], cooldown, alert_payload=payload)
    assert isinstance(out["HKG→台北 (TPE)"], dict)
    assert out["HKG→台北 (TPE)"]["price"] == 1278
    assert out["HKG→台北 (TPE)"]["amount"] == -160
    print("  ✓ test_mark_alerted_with_payload_creates_dict")


def test_mark_alerted_legacy_fallback_when_no_payload():
    """When payload is empty, plain-string format is used."""
    cooldown = {}
    out = sfr.mark_alerted(["HKG→BKK"], cooldown)
    assert isinstance(out["HKG→BKK"], str), f"Expected string, got {type(out['HKG→BKK'])}"
    print("  ✓ test_mark_alerted_legacy_fallback_when_no_payload")


def test_mark_alerted_gc_removes_expired():
    """Entries older than COOLDOWN_WINDOW (24h) are GC'd."""
    cooldown = {
        "OLD": {"ts": _ago(30), "price": 1000, "pct": -5, "amount": -50},
        "NEW": {"ts": _ago(1), "price": 500, "pct": -10, "amount": -60},
    }
    out = sfr.mark_alerted([], cooldown)
    assert "OLD" not in out, f"OLD should be GC'd, keys={list(out.keys())}"
    assert "NEW" in out
    print("  ✓ test_mark_alerted_gc_removes_expired")


# ─── Round-trip: alert → cooldown → suppress ────────────────────────

def test_round_trip_phantom_suppression():
    """Full workflow: alert a drop, then verify a re-fire with the same
    numbers is suppressed even after the 6h time window."""
    # Simulate first alert: TPE drops 1438 → 1278
    initial_fresh = [{
        "price": 1278, "drop_pct": -11.1, "drop_amount": -160,
        "route_key": "HKG→台北 (TPE)",
    }]
    cooldown = {}
    payload = {d["route_key"]: {"price": d["price"], "drop_pct": d["drop_pct"],
                                 "drop_amount": d["drop_amount"]}
                for d in initial_fresh}
    cooldown = sfr.mark_alerted(
        [d["route_key"] for d in initial_fresh],
        cooldown,
        alert_payload=payload,
    )

    # Now 8 hours later, the same exporter cycle reproduces identical numbers
    rerun_fresh = [{
        "price": 1278, "drop_pct": -11.1, "drop_amount": -160,
        "route_key": "HKG→台北 (TPE)",
    }]
    # Manually age the cooldown entry by 8h
    cooldown["HKG→台北 (TPE)"]["ts"] = _ago(8)

    out = sfr.filter_already_alerted(rerun_fresh, cooldown)
    assert len(out) == 0, "Phantom re-fire should be suppressed after 6h"
    print("  ✓ test_round_trip_phantom_suppression")


def test_round_trip_real_drop_after_phantom():
    """After a phantom has been suppressed, a real price event still fires.

    Hermes 2026-08-22 (CI alerter regression): cooldown used _ago(8).
    After Bug D widened the dedup window 6h→24h, an 8h-old cooldown
    still suppresses the route — the real drop never fires. Move to
    _ago(25) so the entry is reliably outside the 24h window.
    """
    cooldown = {
        "HKG→台北 (TPE)": {"ts": _ago(25), "price": 1278, "pct": -11.1, "amount": -160}
    }
    fresh = [{
        "price": 1050, "drop_pct": -25, "drop_amount": -388,
        "route_key": "HKG→台北 (TPE)",
    }]
    out = sfr.filter_already_alerted(fresh, cooldown)
    assert len(out) == 1, f"Real new drop must fire; got {len(out)}"
    assert out[0]["price"] == 1050
    print("  ✓ test_round_trip_real_drop_after_phantom")


# ─── Runner ──────────────────────────────────────────────────────────

def main():
    tests = [
        # Phantom detection
        test_phantom_detects_matching_fingerprint,
        test_phantom_allows_real_new_drop,
        test_phantom_tolerates_exporter_rounding,
        test_phantom_legacy_entry_never_triggers,
        test_phantom_no_fingerprint_stored,
        # Filtering
        test_filter_suppresses_within_6h,
        test_filter_suppresses_phantom_after_6h,
        test_filter_allows_genuine_new_drop_after_6h,
        test_filter_passes_unseen_route,
        test_filter_mixed_phantom_and_real,
        # Migration
        test_migrate_legacy_to_stamped,
        # mark_alerted
        test_mark_alerted_with_payload_creates_dict,
        test_mark_alerted_legacy_fallback_when_no_payload,
        test_mark_alerted_gc_removes_expired,
        # End-to-end
        test_round_trip_phantom_suppression,
        test_round_trip_real_drop_after_phantom,
    ]
    print(f"Running {len(tests)} tests...")
    failures = []
    for t in tests:
        try:
            t()
        except AssertionError as e:
            failures.append((t.__name__, str(e)))
            print(f"  ✗ {t.__name__}: {e}")
        except Exception as e:
            failures.append((t.__name__, f"{type(e).__name__}: {e}"))
            print(f"  ✗ {t.__name__}: {type(e).__name__}: {e}")
    print()
    if failures:
        print(f"❌ {len(failures)} of {len(tests)} tests FAILED")
        return 1
    print(f"✅ All {len(tests)} tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
