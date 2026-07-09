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
log "Self-heal: re-applying export_all_dates_hkg_v2.py dict patches if missing"
python3 -u /data/export_selfheal.py 2>&1 | tee -a $LOG

# Hermes 2026-07-01: also supervise cn_postpatch_v2.py alongside the main
# scanner. Without this, the post-patcher dies on JSON errors and stays dead
# across container restarts, causing all 20 missing airports to flip back to
# IATA-only names within a single export cycle. The post-patcher is light and
# independent of the main scanner, so we run it as a sibling background loop.
POST_PATCH_SCRIPT=/data/cn_postpatch_v2.py
POST_PATCH_LOG=/data/cn_postpatch_v2.log
if [ -f "$POST_PATCH_SCRIPT" ]; then
  log "Spawning cn_postpatch_v2.py in background (supervised by outer container restart)"
  (
    while true; do
      log "--- Starting cn_postpatch_v2.py ---"
      python3 -u "$POST_PATCH_SCRIPT" 2>&1 | tee -a "$POST_PATCH_LOG"
      EXIT=${PIPESTATUS[0]}
      log "cn_postpatch_v2.py exited code=$EXIT. Restart in 5s."
      sleep 5
    done
  ) &
  POST_PATCH_PID=$!
  log "cn_postpatch_v2.py supervisor PID=$POST_PATCH_PID"
else
  log "WARN: $POST_PATCH_SCRIPT not found - post-patcher not supervised. Chinese names may revert."
fi

# Hermes 2026-07-09: optional SZX detail-scan pilot via free proxy pool.
# Activated by either:
#   (a) SZX_PILOT_ENABLED=1 container env var, OR
#   (b) presence of /data/szx_pilot.flag (touch to start, rm to stop)
# The flag file path avoids needing a docker run -e to enable/disable,
# since the container has no env-var file mechanism.
# Scans just 2 routes (SZX→BKK, SZX→SIN) to validate the proxy
# infrastructure at small scale before scaling to all 50 SZX routes.
# To scale up: raise PILOT_ROUTES in szx_pilot_loop.sh, or remove the
# flag and add a separate spawn for szx_detail_loop.sh.
SZX_PILOT_SCRIPT=/data/szx_pilot_loop.sh
SZX_PILOT_LOG=/data/fli_detail_szx_pilot.log
SZX_PILOT_FLAG=/data/szx_pilot.flag
if { [ "${SZX_PILOT_ENABLED:-0}" = "1" ] || [ -f "$SZX_PILOT_FLAG" ]; } && [ -f "$SZX_PILOT_SCRIPT" ]; then
  log "Spawning SZX detail-scan pilot via free proxy pool (env or flag set)"
  (
    while true; do
      log "--- Starting SZX pilot loop ---"
      bash "$SZX_PILOT_SCRIPT" 2>&1 | tee -a "$SZX_PILOT_LOG"
      EXIT=${PIPESTATUS[0]}
      log "SZX pilot loop exited code=$EXIT. Restart in 10s."
      sleep 10
    done
  ) &
  SZX_PILOT_PID=$!
  log "SZX pilot loop PID=$SZX_PILOT_PID"
elif { [ "${SZX_PILOT_ENABLED:-0}" = "1" ] || [ -f "$SZX_PILOT_FLAG" ]; }; then
  log "WARN: SZX pilot requested but $SZX_PILOT_SCRIPT not found"
fi

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
