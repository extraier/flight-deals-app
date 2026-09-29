# Cooldown fingerprint backfill

`cooldown_fingerprint.py` fills in `amount`/`pct`/`price` fields for entries
in `~/.cache/comparetiger/drop_alert_cooldown.json` that have a `ts` but
null values (bot stamped ts-only because the fingerprint wasn't in the
alert_payload at the time).

For each such entry, it:
1. Parses the destination code from the route_key (`HKG→UO→廣島 (HIJ)` → HIJ)
2. Looks up that destination in the live `/data/all_dates.json` + `/data/all_dates_uo.json`
3. Computes fingerprint from `typicalPrice − newPrice` (signed-negative convention)

## When to run

**Once after the alert_payload fix lands** (commit `0c30957`, 2026-09-29) to
backfill entries that were stamped ts-only before the fix.

After that, new alerts will write real fingerprints at stamp time, so this
script shouldn't be needed again. Re-run only if a future regression makes
the alert_payload incomplete again.

## Usage

```bash
python3 scanner/backfill/cooldown_fingerprint.py
```

The script is idempotent — it only updates entries with null fingerprint.
