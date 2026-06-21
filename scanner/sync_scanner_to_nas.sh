#!/bin/bash
# Sync scanner Python scripts Mac → NAS (and restart affected containers)
#
# Pipeline: ~/fli_*.py + ~/export_all_*.py  →  ssh+cat  →  /volume1/flight-scanner/ on NAS
#           →  docker restart of relevant containers
#
# Trigger: launchd StartInterval = 300s (every 5 min)
#
# Safe to run frequently:
#   - No-op when Mac and NAS copies are identical (mtime + size check)
#   - Skips silently when NAS is unreachable
#   - Logs to /tmp/scanner_sync.log (last 2000 lines, auto-trimmed)
#
# Files tracked (keep in sync with ~/flight-deals-app/scanner/):
#   fli_4x_daily.py                    → restarts fli-scheduler
#   fli_4x_daily_szx.py                → restarts fli-scheduler
#   fli_detail_scan_aggressive.py      → restarts fli-detail-hkg
#   fli_detail_scan_szx.py             → restarts fli-detail-szx
#   export_all_dates_hkg_v2.py         → restarts fli-scheduler
#   export_all_dates_szx.py            → restarts fli-scheduler

export PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin

NAS_HOST="192.168.50.35"
NAS_USER="openclaw"
NAS_SSH_KEY="$HOME/.ssh/ugreen_nas"
NAS_DIR="/volume1/flight-scanner"
LOG="/tmp/scanner_sync.log"

FILES=(
  "fli_4x_daily.py"
  "fli_4x_daily_szx.py"
  "fli_detail_scan_aggressive.py"
  "fli_detail_scan_szx.py"
  "export_all_dates_hkg_v2.py"
  "export_all_dates_szx.py"
)

ts() { date '+%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" >> "$LOG"; }
trim_log() {
  # Keep last 2000 lines
  if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ]; then
    tail -2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

nas_ssh() {
  ssh -i "$NAS_SSH_KEY" \
      -o ConnectTimeout=8 \
      -o StrictHostKeyChecking=accept-new \
      -o BatchMode=yes \
      "$NAS_USER@$NAS_HOST" "$@"
}

trim_log

# Quick reachability check (silent on failure)
if ! nas_ssh "exit 0" 2>/dev/null; then
  log "SKIP: NAS unreachable"
  exit 0
fi

changed=()
for f in "${FILES[@]}"; do
  local_path="$HOME/$f"
  [ -f "$local_path" ] || continue

  # Hash check: only push when content actually differs (mtime alone is unreliable
  # because `cp` and `git checkout` set new mtimes even when content is identical).
  local_md5=$(md5 -q "$local_path" 2>/dev/null)
  nas_md5=$(nas_ssh "md5sum '$NAS_DIR/$f' 2>/dev/null | awk '{print \$1}'" 2>/dev/null)

  if [ -z "$nas_md5" ]; then
    log "MISSING on NAS: $f — will push"
    changed+=("$f")
  elif [ "$local_md5" != "$nas_md5" ]; then
    log "DIFF: $f (local md5=${local_md5:0:8}  nas md5=${nas_md5:0:8})"
    changed+=("$f")
  fi
done

if [ ${#changed[@]} -eq 0 ]; then
  exit 0
fi

# Push changed files via cat-over-ssh (scp is unreliable from this Mac to NAS)
push_failed=0
for f in "${changed[@]}"; do
  if cat "$HOME/$f" | nas_ssh "cat > '$NAS_DIR/$f'"; then
    log "PUSHED: $f"
  else
    log "PUSH FAILED: $f"
    push_failed=1
  fi
done

# If any push failed, don't restart containers (could leave them with half-updated scripts)
if [ "$push_failed" -eq 1 ]; then
  log "ABORT: push failed, not restarting containers"
  exit 1
fi

# Determine which containers to restart (union of changed files)
need_scheduler=0
need_detail_hkg=0
need_detail_szx=0
for f in "${changed[@]}"; do
  case "$f" in
    fli_4x_daily*|export_all_dates*) need_scheduler=1 ;;
    fli_detail_scan_aggressive.py)   need_detail_hkg=1 ;;
    fli_detail_scan_szx.py)          need_detail_szx=1 ;;
  esac
done

restart_list=""
[ "$need_scheduler"  -eq 1 ] && restart_list="$restart_list fli-scheduler"
[ "$need_detail_hkg" -eq 1 ] && restart_list="$restart_list fli-detail-hkg"
[ "$need_detail_szx" -eq 1 ] && restart_list="$restart_list fli-detail-szx"

if [ -n "$restart_list" ]; then
  # No-op if a container is already stopped (don't accidentally start it)
  running=$(nas_ssh "docker ps --format '{{.Names}}'" 2>/dev/null)
  to_restart=""
  for c in $restart_list; do
    if echo "$running" | grep -qx "$c"; then
      to_restart="$to_restart $c"
    else
      log "WARN: $c not running on NAS — not starting it"
    fi
  done
  if [ -n "$to_restart" ]; then
    if nas_ssh "docker restart $to_restart" >/dev/null 2>&1; then
      log "RESTART: $to_restart"
    else
      log "RESTART FAILED: $to_restart"
      exit 1
    fi
  fi
fi

log "OK: ${#changed[@]} file(s) synced"
