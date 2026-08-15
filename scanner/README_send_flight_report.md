# Mac-side: `send_flight_report.py`

Hourly Telegram deal alerter for the CompareTiger flight deals chat. Reads
live data from the deployed Vercel `/api/deals` endpoint, computes fresh
drops and stable deals, formats the message, and sends via the configured
Telegram bot token.

This script is the actual sender that produced the `🦅 CompareTiger 機票快訊`
message in chat -181186542 / group -5361948521. It is **not** the legacy
`calendar_drop_alerter.py` (different format, different path, broken token).

## Architecture

```
Vercel /api/deals?dep=HKG&force=1  ─┐
Vercel /api/deals?dep=SZX&force=1  ─┼─→ send_flight_report.py ─→ Telegram
local  all_dates_cx.json            ─┘                            │
                                                                     │
                                       ~/.cache/comparetiger/       │
                                          drop_alert_cooldown.json ◄┘
                                       (6h time-window dedup + price
                                        fingerprint phantom detection)
```

The script always reads live data from `/api/deals` first; if the network
call fails it falls back to a local `~/flight-deals-app/src/data/*.json`
copy (which `sync_flightdeals.sh` keeps warm as a side-effect of running
before the API fetch).

## Deployment

The script lives at `scanner/send_flight_report.py` in this repo. To
deploy on the Mac:

```bash
# 1. Copy the script to a stable location (the launchd plist expects
#    a fixed path; /Users/roger/ is the canonical Mac-side location).
cp /Users/roger/Projects/flight-deals-app/scanner/send_flight_report.py \
   /Users/roger/send_flight_report.py
cp /Users/roger/Projects/flight-deals-app/scanner/sync_flightdeals.sh \
   /Users/roger/sync_flightdeals.sh
chmod +x /Users/roger/send_flight_report.py /Users/roger/sync_flightdeals.sh

# 2. Install the launchd plist (already in this repo at the root).
cp /Users/roger/Projects/flight-deals-app/com.comparetiger.flight-report.plist \
   ~/Library/LaunchAgents/

# 3. Generate a Telegram bot token if you don't have one:
#    - Talk to @BotFather on Telegram
#    - /newbot, copy the token
#    - Get your chat_id by messaging the bot and visiting:
#      https://api.telegram.org/bot<TOKEN>/getUpdates
#    - Add the user / group the bot should post to.

# 4. Inject the token into the plist (NEVER commit this):
TELEGRAM_BOT_TOKEN='8612861184:AAH...your_token_here...'
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables dict" \
    ~/Library/LaunchAgents/com.comparetiger.flight-report.plist
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:TELEGRAM_BOT_TOKEN string $TELEGRAM_BOT_TOKEN" \
    ~/Library/LaunchAgents/com.comparetiger.flight-report.plist

# 5. Reload the launchd job:
launchctl unload ~/Library/LaunchAgents/com.comparetiger.flight-report.plist
launchctl load ~/Library/LaunchAgents/com.comparetiger.flight-report.plist
```

## Dry-run (no token required)

```bash
cd /Users/roger/Projects/flight-deals-app/scanner
python3 send_flight_report.py --dry-run
```

This prints the would-be Telegram message without sending. Useful for
testing threshold changes or for sanity-checking after a deploy.

## Tests

```bash
cd /Users/roger/Projects/flight-deals-app/scanner
python3 test_send_flight_report.py
```

16 tests cover:

  * Phantom detection (matching fingerprint, different price, $1 tolerance)
  * Time-window dedup (within 6h, after 6h, mixed real + phantom)
  * Legacy cooldown migration (plain-string → stamped dict)
  * `mark_alerted` (stamped format, plain-string fallback, GC)
  * Round-trip: alert → cooldown → suppress → real-new-drop passes

## Configuration

All constants are at the top of the script and can be overridden via
environment variables:

| Constant | Default | Env var |
|---|---|---|
| `FLIGHT_DEALS_API_BASE` | `https://flight-deals-app-seven.vercel.app` | `FLIGHT_DEALS_API_BASE` |
| `FLIGHT_DATA_DIR` | `~/flight-deals-app/src/data` | `FLIGHT_DATA_DIR` |
| `TELEGRAM_CHAT_ID` | `181186542` (Home) | `TELEGRAM_CHAT_ID` |
| `COOLDOWN_PATH` | `~/.cache/comparetiger/drop_alert_cooldown.json` | `COOLDOWN_PATH` |
| `COOLDOWN_DEDUP_WINDOW` | 6h | (hardcoded) |
| `COOLDOWN_WINDOW` | 24h (GC) | (hardcoded) |
| `FRESH_DROP_MIN_PCT` | 1.0% | (hardcoded) |
| `STABLE_DEAL_MIN_PCT` | 15.0% | (hardcoded) |

For thresholds you want to tune regularly (e.g. during testing),
env-var overrides can be added — open an issue if you need them.

## Phantom-repeat fix (Bug C, 2026-08-15)

The cooldown file now stores a `(price, drop_pct, drop_amount)` fingerprint
alongside the timestamp. When a new fresh drop matches the previously
alerted tuple within $1 HKD tolerance, it is suppressed regardless of
the 6h time window. This catches the case where the scanner's
`historical_prices` baseline is stale (per Manus S-13), causing the
exporter's `history.1d` math to reproduce the same numbers across cycles.

See `scanner/test_send_flight_report.py::test_round_trip_phantom_suppression`
for the regression test.

## Related skills

  * `flight-deals-telegram-drop-alert` — docs on the older alerter path
    (`calendar_drop_alerter.py` — different format, broken token, not
    the active sender).
  * `macos-launchd-vercel-pipeline::telegram-destination-level-phantom-alert.md`
    — long-form postmortem of the BKK phantom-repeat case (June 2026)
    that motivated the 6h rolling cooldown and the phantom detection.
