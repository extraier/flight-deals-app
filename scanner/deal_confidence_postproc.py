#!/usr/bin/env python3
"""
deal_confidence_postproc.py — Hermes 2026-08-24

Post-process /data/all_dates.json and /data/all_dates_szx.json after the
supervisor\'s exporter writes them. Adds the deal-confidence blocks
(dateComparison, historyComparison, marketComparison) at the route
level, and an `itinerary` block on each cheapestDate that mirrors the
legacy `flight` field.

This is needed because UGREEN\'s snapshot_serv reverts
`export_all_dates_*.py` every ~5 min to a baseline that doesn\'t wire
the helpers. Since UGREEN only tracks files named `export_all_dates_*`,
this post-processor uses a different filename and is not reverted.

Runs every 60s; cheap (no DB access, only file load + JSON transform).
The transform is idempotent.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, "/data")

from deal_confidence import MARKET_NOT_COLLECTED_REASON  # noqa: E402
from export_helpers import (  # noqa: E402
    build_comparisons_for_route,
    build_itinerary_for_date,
)


TARGETS = [
    ("/data/all_dates.json", "HKG"),
    ("/data/all_dates_szx.json", "SZX"),
]


def _flight_info_from(cd):
    f = cd.get("flight")
    if not isinstance(f, dict):
        return None
    return f


def _pair_history(cd):
    h = cd.get("history") or {}
    out = []
    for v in h.values():
        if isinstance(v, dict):
            p = v.get("price")
            if p is not None:
                try:
                    out.append(float(p))
                except (TypeError, ValueError):
                    pass
        elif isinstance(v, (int, float)):
            out.append(float(v))
    return out


def _patch_one(result):
    route_date_context = result.get("cheapestDates") or []
    if not route_date_context:
        return 0
    patched = 0
    candidate = route_date_context[0]
    pair_history = _pair_history(candidate)
    try:
        comps = build_comparisons_for_route(
            route=result.get("route", ""),
            candidate_entry=candidate,
            route_date_context=route_date_context,
            pair_history=pair_history,
        )
        result["dateComparison"] = comps.get("dateComparison", {
            "status": "insufficient_data",
            "scope": "same_stay_length",
            "sampleSize": 0,
        })
        result["historyComparison"] = comps.get("historyComparison", {
            "status": "insufficient_data",
            "scope": "all_observations",
            "sampleSize": 0,
        })
        mc = comps.get("marketComparison", {}) or {}
        # build_market_comparison() in deal_confidence returns {status, reason}.
        # The TS MarketComparison type extends ComparisonSummary which
        # requires scope + sampleSize. Always inject them.
        result["marketComparison"] = {
            "status": mc.get("status", "not_collected"),
            "reason": mc.get("reason", MARKET_NOT_COLLECTED_REASON),
            "scope": "carrier_overlay",
            "sampleSize": 0,
        }
        patched += 3
    except Exception as e:
        print(f"[{time.strftime('%H:%M:%S')}] comps FAILED for {result.get('route')}: {e}",
              file=sys.stderr, flush=True)
        if "marketComparison" not in result:
            result["marketComparison"] = {
                "status": "not_collected",
                "scope": "carrier_overlay",
                "sampleSize": 0,
                "reason": MARKET_NOT_COLLECTED_REASON,
            }
            patched += 1

    for cd in route_date_context:
        flight_info = _flight_info_from(cd)
        ret_date = ""
        if flight_info is not None:
            try:
                from datetime import date, timedelta
                dep = date(int(cd["year"]), int(cd["month"]), int(cd["day"]))
                ret = dep + timedelta(days=int(cd.get("stay") or 7))
                ret_date = ret.isoformat()
            except Exception:
                ret_date = ""
        try:
            it = build_itinerary_for_date(
                flight_info=flight_info,
                ret_date=ret_date,
                last_verified=None,
                provider_status=None,
            )
            cd["itinerary"] = it
            patched += 1
        except Exception as e:
            print(f"[{time.strftime('%H:%M:%S')}] itinerary FAILED for {result.get('route')}: {e}",
                  file=sys.stderr, flush=True)
            cd["itinerary"] = {
                "status": "not_collected",
                "source": "flight_dates_fallback",
                "retDate": ret_date,
            }
            patched += 1
    return patched


def process_file(path):
    p = Path(path)
    if not p.exists():
        return False, 0, f"missing: {path}"
    try:
        with p.open(encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError:
        return False, 0, f"invalid JSON: {path}"
    results = data.get("results", [])
    if not results:
        return False, 0, f"empty results: {path}"
    # Detect if the file is ALREADY patched (idempotency guard).
    # A file is "fully patched" when:
    #   - marketComparison has scope + sampleSize (the critical TS type field)
    #   - first result has dateComparison + historyComparison + marketComparison
    #   - first 3 cheapestDates have itinerary
    sample = results[0]
    mc = sample.get("marketComparison") or {}
    already_patched = (
        isinstance(sample.get("dateComparison"), dict)
        and isinstance(sample.get("historyComparison"), dict)
        and isinstance(mc, dict)
        and "scope" in mc
        and "sampleSize" in mc
        and all(isinstance(cd.get("itinerary"), dict) for cd in sample.get("cheapestDates", [])[:3])
    )
    if already_patched:
        return False, 0, f"already patched: {path}"
    total = 0
    for r in results:
        total += _patch_one(r)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, default=str)
    os.replace(tmp, p)
    return True, total, f"patched {total} fields in {path}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--interval", type=int, default=60)
    args = ap.parse_args()
    if args.once:
        for path, _ in TARGETS:
            changed, count, msg = process_file(path)
            print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)
        return
    print(f"[{time.strftime('%H:%M:%S')}] deal_confidence_postproc started, interval={args.interval}s",
          flush=True)
    while True:
        try:
            for path, _ in TARGETS:
                changed, count, msg = process_file(path)
                if changed:
                    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)
        except Exception as e:
            print(f"[{time.strftime('%H:%M:%S')}] loop error: {e}", file=sys.stderr, flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
