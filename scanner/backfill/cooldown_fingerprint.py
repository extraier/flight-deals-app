#!/usr/bin/env python3
"""Backfill drop_alert_cooldown.json with amount/pct/price fingerprints.

For each entry that has a timestamp but null amount/pct/price (bot stamped
ts-only because the fingerprint wasn't in alert_payload at the time), compute
the fingerprint from the live scanner baseline (typicalPrice vs newPrice).

The typicalPrice-vs-newPrice derivation matches what the web view does, so
the resulting entries will display correctly on /deals.

Hermes 2026-09-29: run this once to backfill the existing cooldown; after the
send_flight_report.py fix lands (commit 0c30957), future entries will have
proper fingerprints at alert time, making this script unnecessary.
"""
import json, re
from pathlib import Path


def backfill(cooldown: dict, all_dates: dict) -> tuple[int, int]:
    """Return (filled_count, skipped_count).

    Mutates `cooldown` in place. `all_dates` must have `results` and `uoDrops`
    keys (as the export script writes).
    """
    by_code: dict[str, dict] = {}
    for r in all_dates.get('results', []):
        code = r.get('destination', {}).get('code', '')
        by_code[code] = r
    for r in all_dates.get('uoDrops', []):
        code = r.get('destination', {}).get('code', '')
        if code and code not in by_code:
            by_code[code] = r

    filled = skipped = 0
    for key, entry in cooldown.items():
        if not isinstance(entry, dict):
            skipped += 1
            continue
        if entry.get('amount') is not None and entry.get('pct') is not None:
            skipped += 1
            continue
        m = re.match(r'(?:^|→|:HKG→)(.+?)\s*\(([A-Z]{3})\)\s*$', key)
        if not m:
            skipped += 1
            continue
        code = m.group(2)
        r = by_code.get(code)
        if not r:
            skipped += 1
            continue
        cd0 = (r.get('cheapestDates') or [{}])[0]
        new_price = cd0.get('price') or r.get('price') or 0
        typical = r.get('typicalPrice') or 0
        if typical > new_price > 0:
            abs_amount = int(typical - new_price)
            abs_pct = round((abs_amount / typical) * 1000) / 10
            entry['price'] = new_price
            entry['amount'] = -abs_amount
            entry['pct'] = -abs_pct
            filled += 1
        else:
            skipped += 1
    return filled, skipped


def main():
    cd_path = Path.home() / '.cache/comparetiger/drop_alert_cooldown.json'
    ad_path = Path('/Users/roger/Projects/flight-deals-app/src/data/all_dates.json')

    cooldown = json.load(open(cd_path))
    all_dates = json.load(open(ad_path))

    filled, skipped = backfill(cooldown, all_dates)
    with open(cd_path, 'w') as f:
        json.dump(cooldown, f, indent=2, ensure_ascii=False)

    print(f"filled={filled} skipped={skipped}")
    print(f"Updated: {cd_path}")


if __name__ == '__main__':
    main()
