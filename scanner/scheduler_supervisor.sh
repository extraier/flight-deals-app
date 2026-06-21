#!/bin/bash
# Supervised flight-scanner scheduler.
# Wraps the chosen scanner in a restart loop so it survives earlyoom kills.
# Lives in its own container with --restart unless-stopped.
#
# Mode is controlled by SCAN_MODE env var:
#   SCAN_MODE=continuous  (default)  → fli_4x_continuous.py  (HKG + SZX 24/7, 60s/route, 10min gap)
#   SCAN_MODE=4x                      → fli_scheduler_4x.py   (UTC 0/6/12/18 = HKT 8/14/20/02)
#
# Toggle at runtime by changing env var in container and restarting, e.g.:
#   docker exec fli-scheduler bash -c "echo 'SCAN_MODE=4x' >> /data/scheduler_supervisor.env"
#   docker restart fli-scheduler
set -e

# Hermes: HKT timestamps everywhere
export TZ=Asia/Hong_Kong

LOG=/data/scheduler_supervisor.log
SCAN_MODE=${SCAN_MODE:-continuous}

case "$SCAN_MODE" in
  continuous)
    SCRIPT=/data/fli_4x_continuous.py
    LABEL="CONTINUOUS scanner (HKG + SZX, 60s/route, 10min gap)"
    ;;
  4x)
    SCRIPT=/data/fli_scheduler_4x.py
    LABEL="4x scheduler (UTC 0/6/12/18 = HKT 8/14/20/02)"
    ;;
  *)
    echo "FATAL: unknown SCAN_MODE=$SCAN_MODE (expected 'continuous' or '4x')" | tee -a "$LOG"
    while true; do sleep 3600; done
    ;;
esac

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

log "===== SUPERVISOR STARTED (pid $$, mode=$SCAN_MODE) ====="
log "Mode: $LABEL"
log "Script: $SCRIPT"

# Pre-flight checks
if [ ! -f "$SCRIPT" ]; then
  log "FATAL: script not found at $SCRIPT"
  if [ -f "/tmp/$(basename $SCRIPT)" ]; then
    log "Recovering from /tmp copy..."
    cp "/tmp/$(basename $SCRIPT)" "$SCRIPT"
  else
    log "Sleeping forever; cannot find script anywhere."
    while true; do sleep 3600; done
  fi
fi

if [ ! -f /data/fli_calendar.db ]; then
  log "ERROR: /data/fli_calendar.db missing. Sleeping 60s before retry."
  sleep 60
fi

log "Pre-flight OK. Looping $SCRIPT with auto-restart."

RESTART=0
while true; do
  log "--- Starting scanner (restart #$RESTART) ---"
  START=$(date +%s)
  python3 "$SCRIPT" 2>&1 | tee -a "$LOG"
  EXIT=$?
  DURATION=$(( $(date +%s) - START ))
  RESTART=$((RESTART + 1))
  log "Scanner exited code=$EXIT after ${DURATION}s. Restart #$RESTART in 10s."
  sleep 10
done
