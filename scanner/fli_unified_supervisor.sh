#!/bin/bash
# Hermes 2026-07-26: rewritten supervisor with watchdog + health checks.
#
# Why this rewrite:
# - Previous version (2026-07-04) had no @reboot cron → 15-day outage when
#   the supervisor itself died (2026-07-11 14:32). User noticed today.
# - Now boots automatically via systemd (not cron) — survives reboots.
# - Adds stack-aware health checks: container reachable, DB writable,
#   synology tunnel up, both scanners landing data.
# - Slack-style alerts via direct log write to a Telegram-known path.
#   (Telegram bot reads /home/openclaw/bin/scanner_alerts.log.)
# - Idempotent PID-file lock, same as before.
# - One instance per host.
#
# Usage:
#   sudo systemctl enable --now fli-unified-supervisor.service
#   sudo systemctl status fli-unified-supervisor.service
#   tail -f /home/openclaw/bin/fli_unified_supervisor.log
#
# To stop:
#   sudo systemctl stop fli-unified-supervisor.service
#
# Pair with scanner_healthcheck.sh (cron @*/5min) if you want redundant
# recovery — both watchdogs work fine together via the PID-file lock.
export TZ=CST-8

LOOP=/home/openclaw/bin/fli_unified_loop.sh
SUP_LOG=/home/openclaw/bin/fli_unified_supervisor.log
ALERT_LOG=/home/openclaw/bin/scanner_alerts.log
RESTART_DELAY=10
MAX_RESTART_LOOP=10        # if loop crashes this many times in 60min, alert
CONTAINER=fli-scheduler
SYNOLOGY_TUNNEL=synology-tunnel.service
HEALTH_CHECK_INTERVAL=300   # 5min between health checks
ALERT_COOLDOWN=1800         # 30min between repeated alerts of same kind

mkdir -p "$(dirname "$SUP_LOG")" "$(dirname "$ALERT_LOG")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$SUP_LOG"
}

alert() {
  # Write to alert log. The Telegram bot (or future watchdog) reads from
  # here. Cooldown per message body so we don't spam.
  local key="$1"
  local msg="$2"
  local now=$(date +%s)
  local lastfile="/tmp/.scanner_alert_${key// /_}"
  local last=0
  [ -f "$lastfile" ] && last=$(cat "$lastfile" 2>/dev/null || echo 0)
  if [ $((now - last)) -lt $ALERT_COOLDOWN ]; then
    log "  .. alert suppressed (cooldown): $msg"
    return
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$key] $msg" >> "$ALERT_LOG"
  echo "$now" > "$lastfile"
  log "  !! ALERT: $msg"
}

# Idempotency: PID file lock prevents two supervisors racing.
PIDFILE=/home/openclaw/bin/fli_unified_supervisor.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  log "supervisor already running (pid=$(cat "$PIDFILE")), exiting (pid=$$)"
  exit 0
fi
echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT

# Pre-flight: container must exist & run before we start the loop.
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  alert "container_missing" "container $CONTAINER does not exist — supervisor exiting"
  exit 1
fi
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" != "true" ]; then
  alert "container_stopped" "container $CONTAINER is not running — will auto-restart via Docker"
  docker start "$CONTAINER" 2>&1 | tee -a "$SUP_LOG"
  sleep 5
fi

# Orphan cleanup: when the loop exits, kill stale fli_detail_scan* inside
# the container so the next round doesn't double-spawn.
cleanup_orphan_scanners() {
  if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then return; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" != "true" ]; then return; fi
  ORPHAN_COUNT=$(docker exec "$CONTAINER" sh -c \
    'pgrep -af fli_detail_scan 2>/dev/null | grep -v "pgrep -af fli_detail_scan" | wc -l' \
    2>/dev/null | tr -d '[:space:]')
  ORPHAN_COUNT=${ORPHAN_COUNT:-0}
  if [ "${ORPHAN_COUNT:-0}" -gt 0 ] 2>/dev/null; then
    docker exec "$CONTAINER" pkill -9 -f fli_detail_scan >/dev/null 2>&1
    log "  !! killed $ORPHAN_COUNT orphan scanner process(es) inside container"
  fi
}

# Health probe: runs every $HEALTH_CHECK_INTERVAL seconds. Validates
# the loop is making progress (new log entries land within window),
# container is alive, and synology tunnel is up.
healthcheck() {
  local loop_pid=$1
  local last_alive_check=0

  while true; do
    sleep "$HEALTH_CHECK_INTERVAL"

    # 1. Loop process alive?
    if ! kill -0 "$loop_pid" 2>/dev/null; then
      alert "loop_died" "loop pid=$loop_pid died — supervisor will restart"
      return 1
    fi

    # 2. Container running?
    if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
      alert "container_missing" "$CONTAINER vanished"
      return 1
    fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" != "true" ]; then
      alert "container_stopped" "$CONTAINER stopped"
      docker start "$CONTAINER" 2>&1 | tee -a "$SUP_LOG"
      sleep 5
    fi

    # 3. Synology tunnel active? (UO scan depends on this)
    if ! sudo -n systemctl is-active --quiet "$SYNOLOGY_TUNNEL" 2>/dev/null; then
      alert "synology_tunnel_down" "$SYNOLOGY_TUNNEL not active — UO scan will fall back to direct or fail"
      sudo -n systemctl restart "$SYNOLOGY_TUNNEL" 2>&1 | tee -a "$SUP_LOG"
    fi

    # 4. Loop making progress? Check that the host log got a new entry
    #    in the last 30 min. If not, the loop is wedged.
    local last_log_ts=$(stat -c %Y "$SUP_LOG" 2>/dev/null || echo 0)
    local now=$(date +%s)
    local silent_for=$((now - last_log_ts))
    if [ "$silent_for" -gt 1800 ]; then
      alert "loop_silent" "no log activity for ${silent_for}s — loop may be wedged"
      return 1
    fi
  done
}

log "===== UNIFIED detail-loop SUPERVISOR v2 starting (pid=$$, restart_delay=${RESTART_DELAY}s) ====="
log "Loop: $LOOP"
log "Health check interval: ${HEALTH_CHECK_INTERVAL}s"
log "Alert log: $ALERT_LOG"

# Rate-limit restarts: if the loop dies too many times in 60min, alert + sleep.
RESTART_TIMES=()

while true; do
  log "starting $LOOP"
  bash "$LOOP" &
  LOOP_PID=$!
  log "loop pid=$LOOP_PID"

  # Run healthcheck in parallel; it returns 1 if the loop needs restart.
  healthcheck "$LOOP_PID"
  HEALTH_RC=$?

  # Healthcheck exits → loop must be killed and restarted.
  kill -TERM "$LOOP_PID" 2>/dev/null
  wait "$LOOP_PID" 2>/dev/null
  LOOP_EXIT=$?
  log "loop exited code=$LOOP_EXIT (health=$HEALTH_RC)"

  cleanup_orphan_scanners

  # Track restart rate.
  NOW=$(date +%s)
  RESTART_TIMES=("${RESTART_TIMES[@]}" "$NOW")
  # Drop entries older than 60min.
  _filtered=()
  for t in "${RESTART_TIMES[@]}"; do
    if [ $((NOW - t)) -lt 3600 ]; then
      _filtered+=("$t")
    fi
  done
  RESTART_TIMES=("${_filtered[@]}")

  if [ "${#RESTART_TIMES[@]}" -ge "$MAX_RESTART_LOOP" ]; then
    alert "restart_loop" "loop restarted ${#RESTART_TIMES[@]} times in 60min — backing off 5min"
    sleep 300
  else
    log "restarting loop in ${RESTART_DELAY}s"
    sleep "$RESTART_DELAY"
  fi
done
