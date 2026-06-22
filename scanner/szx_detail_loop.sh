#!/bin/bash
export TZ=CST-8
# Continuous SZX detail scanner.
# Runs fli_detail_scan_szx.py in a loop, with a short pause between rounds.

SCRIPT=/data/fli_detail_scan_szx.py
LOG=/data/fli_detail_szx.log
PAUSE_SECONDS=120  # pause between full scans — was 60, raised to ease 429 pressure

cd /data

echo "[$(date)] SZX detail continuous loop starting (pid=$$)" > "$LOG"
echo "Script: $SCRIPT" >> "$LOG"
echo "Pause between rounds: ${PAUSE_SECONDS}s" >> "$LOG"
echo "==========================================" >> "$LOG"

ROUND=0
while true; do
  ROUND=$((ROUND + 1))
  echo "" >> "$LOG"
  echo "[$(date)] === SZX detail round #$ROUND starting ===" >> "$LOG"

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
