#!/bin/bash
# Sync HKG + SZX + UO + CX flight deal data → local files only
#
# Pipeline: NAS /data/all_dates*.json → local files (no git push, no Vercel)
#
# 2026-06-22 refactor — Hermes:
#   Previously this script committed + pushed data JSONs to GitHub every 50 min
#   to refresh the Vercel static fallback. With Tailscale Funnel serving live
#   data via /api/deals, the static fallback is rarely hit — but Vercel Hobby
#   has a 100 deploys/day limit and the auto-pushes burned it in hours.
#   Now we ONLY update local src/data/all_dates*.json (which Vercel would use
#   as fallback if the funnel is unreachable) — no git, no deploys.
#   Code commits go through a separate manual workflow (see CONTRIBUTING.md).
#
# 2026-07-27 — added CX (Cathay Pacific):
#   Pulled from the flight-scanner-cx container, where the new
#   /app/cx/scripts/export_all_dates_cx.py converts run_latest_cx.json
#   into the same shape as HKG/SZX all_dates.json.
#
# 2026-09-07 — Hermes: consolidated UO + CX into fli-scheduler container
#   The flight-scanner-cx container is gone. UO/CX JSONs are now generated
#   by /data/export_all_dates_airline.py inside fli-scheduler and read
#   straight from there.

export PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin

NAS_HOST="192.168.50.35"
NAS_USER="openclaw"
NAS_SSH_KEY="$HOME/.ssh/ugreen_nas"
APP_DIR="/Users/roger/flight-deals-app"
LOG="/tmp/flightdeals_cron.log"
CONTAINER="fli-scheduler"

ts() { date '+%m-%d %H:%M'; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

log "FlightDeals sync..."

# SSH helper
NAS_SSH="ssh -i $NAS_SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 $NAS_USER@$NAS_HOST"

# Sanity check the source container is running
if ! $NAS_SSH "docker inspect -f '{{.State.Running}}' $CONTAINER 2>/dev/null" 2>/dev/null | grep -q true; then
  log "ERROR: container '$CONTAINER' not running on NAS — skipping"
  exit 1
fi

# Run the airline exporter (UO + CX) before pulling. Hermes 2026-09-07:
# exporter lives inside fli-scheduler (was flight-scanner-cx previously).
# Idempotent + ~3s — ensures all_dates_uo.json + all_dates_cx.json are
# freshly normalized from the historical_prices_uo/_cx SQLite tables
# before we ship them.
$NAS_SSH "docker exec $CONTAINER python3 /data/export_all_dates_airline.py uo cx" >/dev/null 2>&1 || \
    log "WARN: airline exporter failed (non-fatal)"

# Pull HKG + SZX + UO + CX JSONs from the scheduler container
tmp_hkg=$(mktemp)
tmp_szx=$(mktemp)
tmp_uo=$(mktemp)
tmp_cx=$(mktemp)
$NAS_SSH "docker exec $CONTAINER cat /data/all_dates.json"     > "$tmp_hkg" 2>/dev/null
$NAS_SSH "docker exec $CONTAINER cat /data/all_dates_szx.json" > "$tmp_szx" 2>/dev/null
$NAS_SSH "docker exec $CONTAINER cat /data/all_dates_uo.json"  > "$tmp_uo"  2>/dev/null
$NAS_SSH "docker exec $CONTAINER cat /data/all_dates_cx.json"  > "$tmp_cx"  2>/dev/null

hkg_bytes=$(stat -f%z "$tmp_hkg" 2>/dev/null || echo 0)
szx_bytes=$(stat -f%z "$tmp_szx" 2>/dev/null || echo 0)
uo_bytes=$(stat -f%z "$tmp_uo" 2>/dev/null || echo 0)
cx_bytes=$(stat -f%z "$tmp_cx" 2>/dev/null || echo 0)

log "Pulled HKG=${hkg_bytes}B SZX=${szx_bytes}B UO=${uo_bytes}B CX=${cx_bytes}B"

# Bail if both HKG and SZX are empty (CX/UO are optional)
if [ "$hkg_bytes" -lt 100 ] && [ "$szx_bytes" -lt 100 ]; then
  log "ERROR: both HKG+SZX files empty, aborting"
  rm -f "$tmp_hkg" "$tmp_szx" "$tmp_uo" "$tmp_cx"
  exit 1
fi

# Update local copies only if non-empty (these become the Vercel static fallback
# at the next code deploy — kept fresh here so when we DO deploy, the fallback
# is up-to-date).
[ "$hkg_bytes" -ge 100 ] && cp "$tmp_hkg" "$APP_DIR/src/data/all_dates.json"
[ "$szx_bytes" -ge 100 ] && cp "$tmp_szx" "$APP_DIR/src/data/all_dates_szx.json"
[ "$uo_bytes"  -ge 100 ] && cp "$tmp_uo"  "$APP_DIR/src/data/all_dates_uo.json" || log "WARN: UO file empty/missing — skipping"
[ "$cx_bytes"  -ge 100 ] && cp "$tmp_cx"  "$APP_DIR/src/data/all_dates_cx.json" || log "WARN: CX file empty/missing — skipping"
rm -f "$tmp_hkg" "$tmp_szx" "$tmp_uo" "$tmp_cx"

# Hermes 2026-09-29: push cooldown + UO sidecars to the NAS fli-data-server so
# the /api/deals response (served via Tailscale Funnel) includes the
# 持續跌價 view data on the web. The cooldown is created by the hourly
# Telegram bot on this Mac at ~/.cache/comparetiger/drop_alert_cooldown.json
# — pushing it to /volume1/flight-scanner/ makes it readable by fli-data-server
# which augments it into the /all_dates.json response on each request.
# This direction is Mac → NAS (the rest of the script is NAS → Mac).
if [ -f "$HOME/.cache/comparetiger/drop_alert_cooldown.json" ]; then
  cd_bytes=$(stat -f%z "$HOME/.cache/comparetiger/drop_alert_cooldown.json" 2>/dev/null || echo 0)
  if [ "$cd_bytes" -ge 100 ]; then
    cat "$HOME/.cache/comparetiger/drop_alert_cooldown.json" | \
      $NAS_SSH "sudo tee /volume1/flight-scanner/all_dates_cooldown.json > /dev/null && sudo chmod 644 /volume1/flight-scanner/all_dates_cooldown.json" >/dev/null 2>&1 \
      && log "Pushed cooldown to NAS (${cd_bytes}B)" \
      || log "WARN: cooldown push to NAS failed (non-fatal)"
  fi
fi

log "Local files updated (no git push). Run 'cd $APP_DIR && git status' to see pending changes."
