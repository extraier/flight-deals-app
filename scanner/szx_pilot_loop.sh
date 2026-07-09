#!/bin/bash
# Hermes 2026-07-09: Conservative SZX detail-scan pilot.
#
# Spawned by scheduler_supervisor.sh only when SZX_PILOT_ENABLED=1.
# Scans 2-3 SZX routes through the free proxy pool to validate that
# the proxy infrastructure works at small scale before scaling up.
#
# Why so small:
# - Google Flights' per-IP rate limit is aggressive on Chinese-origin
#   queries. We hit 100% 429 on the home IP (see fli_detail_szx.log
#   2026-07-05 21:48). Free proxies rotate the exit IP but are flaky
#   (50%+ die within an hour).
# - 2 routes × ~30 dates each ≈ 60 detail queries per round. That's
#   enough to exercise the proxy pool's rotation, cooldown, and TTL
#   paths without burning through our daily request budget if proxies
#   go bad.
# - 2 routes is enough to compare success rates against the home-IP
#   baseline (which was 0% success post-429).
#
# Scaling:
# - Once we see 2 successful rounds with stable proxies, raise
#   PILOT_ROUTES to 5-10 routes for a few days, then to all 50.
# - To activate full scan, just set SZX_PILOT_ENABLED=0 (or remove
#   the spawn from supervisor) and run szx_detail_loop.sh directly.
export TZ=CST-8

SCRIPT=/data/fli_detail_scan_szx.py
LOG=/data/fli_detail_szx_pilot.log
PAUSE_SECONDS=180  # 3 min between rounds — was 120, raised to ease proxy churn

# Hermes 2026-07-09: pilot scope — 2 popular Asian routes (BKK + SIN).
# These get the most traffic so calendar data is fresh, and Google
# handles them well across regions (good proxy success rate).
export PILOT_ROUTES="SZX→BKK,SZX→SIN"

# Hermes 2026-07-09: proxy pool on. The default in proxy_pool.activate()
# is to try and bootstrap; this env var makes the intent explicit.
export PROXY_POOL_ENABLED=1

cd /data

echo "[$(date)] SZX PILOT detail continuous loop starting (pid=$$)" > "$LOG"
echo "Script: $SCRIPT" >> "$LOG"
echo "PILOT_ROUTES: $PILOT_ROUTES" >> "$LOG"
echo "Pause between rounds: ${PAUSE_SECONDS}s" >> "$LOG"
echo "==========================================" >> "$LOG"

ROUND=0
while true; do
  ROUND=$((ROUND + 1))
  echo "" >> "$LOG"
  echo "[$(date)] === SZX PILOT detail round #$ROUND starting ===" >> "$LOG"

  START=$(date +%s)
  python3 -u "$SCRIPT" >> "$LOG" 2>&1
  EXIT=$?
  END=$(date +%s)
  DURATION=$((END - START))

  echo "[$(date)] Round #$ROUND done, exit=$EXIT, duration=${DURATION}s. Sleeping ${PAUSE_SECONDS}s." >> "$LOG"

  if [ $EXIT -ne 0 ]; then
    echo "[$(date)] WARNING: non-zero exit. Backing off 5 min before retry." >> "$LOG"
    sleep 300
  else
    sleep $PAUSE_SECONDS
  fi
done