#!/bin/bash
export TZ=CST-8
# Continuous HKG detail scanner.
# Runs fli_detail_scan_aggressive.py in a loop, with a short pause between rounds.
# Exits non-zero only on real failures, so the Docker restart policy keeps it alive.

SCRIPT=/data/fli_detail_scan_aggressive.py
LOG=/data/fli_detail_hkg.log
PAUSE_SECONDS=120  # pause between full scans (round) — was 60, raised to ease 429 pressure

cd /data

echo "[$(date)] HKG detail continuous loop starting (pid=$$)" > "$LOG"
echo "Script: $SCRIPT" >> "$LOG"
echo "Pause between rounds: ${PAUSE_SECONDS}s" >> "$LOG"
echo "==========================================" >> "$LOG"

ROUND=0
while true; do
  ROUND=$((ROUND + 1))
  echo "" >> "$LOG"
  echo "[$(date)] === HKG detail round #$ROUND starting ===" >> "$LOG"

  START=$(date +%s)
  python3 -u "$SCRIPT" >> "$LOG" 2>&1
  EXIT=$?
  END=$(date +%s)
  DURATION=$((END - START))

  echo "[$(date)] Round #$ROUND done, exit=$EXIT, duration=${DURATION}s. Sleeping ${PAUSE_SECONDS}s." >> "$LOG"

  # If the script crashed (non-zero), wait a bit longer before retry
  if [ $EXIT -ne 0 ]; then
    echo "[$(date)] WARNING: non-zero exit. Backing off 5 min before retry." >> "$LOG"
    sleep 300
  else
    sleep $PAUSE_SECONDS
  fi
done
