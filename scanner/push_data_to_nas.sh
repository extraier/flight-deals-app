#!/bin/bash
# Push the Mac-produced data files to the NAS so the self-hosted Next.js
# app can read them from disk.
#
# Hermes 2026-10-27: the app now runs ON the NAS (Next.js standalone on
# :3000), fronted by Tailscale Funnel. Its /api/gflights and /api/alerts
# read gflights_digest.json + drop_alerts.json from
# /volume1/flight-scanner/ on the NAS.
#
# These two files are produced on the Mac:
#   - gflights_digest.json  ← the Gmail poller (scanner/gflights_poller.py)
#   - drop_alerts.json      ← the hourly Telegram report bot
#
# Previously this data reached the site by being committed to git, which
# triggered a Vercel deploy (~27/day — the quota burn the user wanted to
# stop). Now it's a plain file push: no git, no deploy, no quota.
#
# The push is atomic on the NAS side: write to a .tmp file, then mv over
# the target. A reader can never see a half-written JSON.

set -uo pipefail

NAS_HOST="192.168.50.35"
NAS_USER="openclaw"
NAS_SSH_KEY="$HOME/.ssh/ugreen_nas"
APP_DIR="/Users/roger/flight-deals-app"
LOG="/tmp/fli_data_push.log"
NAS_DATA_DIR="/volume1/flight-scanner"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

NAS_SSH="ssh -i $NAS_SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 $NAS_USER@$NAS_HOST"

ts() { date '+%m-%d %H:%M'; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

push_file() {
  local local_path="$1"
  local remote_name="$2"
  local min_bytes="${3:-100}"

  if [ ! -f "$local_path" ]; then
    log "SKIP $remote_name — local file missing: $local_path"
    return 1
  fi

  local bytes
  bytes=$(stat -f%z "$local_path" 2>/dev/null || echo 0)
  if [ "$bytes" -lt "$min_bytes" ]; then
    log "SKIP $remote_name — local file too small ($bytes B < $min_bytes B)"
    return 1
  fi

  # Validate JSON locally before shipping it — a corrupt file on the NAS
  # would make the app serve a broken page with no obvious error.
  if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$local_path" 2>/dev/null; then
    log "SKIP $remote_name — local file is not valid JSON"
    return 1
  fi

  # Atomic push: cat | ssh "cat > tmp && mv tmp target"
  if cat "$local_path" | $NAS_SSH \
      "cat > $NAS_DATA_DIR/${remote_name}.tmp && \
       mv -f $NAS_DATA_DIR/${remote_name}.tmp $NAS_DATA_DIR/${remote_name} && \
       echo ok" 2>/dev/null | grep -q ok; then
    log "PUSHED $remote_name (${bytes}B)"
    return 0
  fi
  log "WARN push failed: $remote_name"
  return 1
}

log "--- pushing data files to NAS ---"
push_file "$APP_DIR/src/data/gflights_digest.json" "gflights_digest.json" 100
push_file "$APP_DIR/src/data/drop_alerts.json" "drop_alerts.json" 100
push_file "$APP_DIR/src/data/trump_alerts.json" "trump_alerts.json" 100
log "--- done ---"
