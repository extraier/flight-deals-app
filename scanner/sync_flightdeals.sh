#!/bin/bash
# Sync HKG + SZX + CX flight deal data → local files only
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
# Trigger: launchd StartInterval = 300s (every 5 min) — DISABLED 2026-06-22.
#   The script is harmless to run manually for a one-off data refresh:
#       bash /Users/roger/sync_flightdeals.sh

export PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin

NAS_HOST="192.168.50.35"
NAS_USER="openclaw"
NAS_SSH_KEY="$HOME/.ssh/ugreen_nas"
APP_DIR="/Users/roger/flight-deals-app"
LOG="/tmp/flightdeals_cron.log"
CONTAINER="fli-scheduler"
CX_CONTAINER="flight-scanner-cx"

ts() { date '+%m-%d %H:%M'; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

log "FlightDeals sync..."

# SSH helper
NAS_SSH="ssh -i $NAS_SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 $NAS_USER@$NAS_HOST"

# Sanity check the source containers exist
if ! $NAS_SSH "docker inspect -f '{{.State.Running}}' $CONTAINER 2>/dev/null" 2>/dev/null | grep -q true; then
  log "ERROR: container '$CONTAINER' not running on NAS — skipping"
  exit 1
fi

# Pull HKG + SZX JSONs from the scheduler container
tmp_hkg=$(mktemp)
tmp_szx=$(mktemp)
$NAS_SSH "docker exec $CONTAINER cat /data/all_dates.json"    > "$tmp_hkg" 2>/dev/null
$NAS_SSH "docker exec $CONTAINER cat /data/all_dates_szx.json" > "$tmp_szx" 2>/dev/null

hkg_bytes=$(stat -f%z "$tmp_hkg" 2>/dev/null || echo 0)
szx_bytes=$(stat -f%z "$tmp_szx" 2>/dev/null || echo 0)

# Pull CX JSON from the CX scanner container. The exporter writes to
# /app/scripts/scan_results/all_dates_cx.json (same dir as the scanner's
# own run_latest_cx.json, both bind-mounted from
# /volume1/flight-scanner/scripts/scan_results/ on NAS).
# We run the exporter first (idempotent, ~2s) so we always pull a freshly
# normalized copy — otherwise we'd be reading whatever the exporter last
# wrote, which could be hours old.
# Best-effort — if the CX container is down or the exporter fails, we
# still ship HKG+SZX so the report is never empty.
$NAS_SSH "docker exec $CX_CONTAINER python3 /app/cx/scripts/export_all_dates_cx.py" >/dev/null 2>&1 || true
tmp_cx=$(mktemp)
$NAS_SSH "docker exec $CX_CONTAINER cat /app/scripts/scan_results/all_dates_cx.json" > "$tmp_cx" 2>/dev/null
cx_bytes=$(stat -f%z "$tmp_cx" 2>/dev/null || echo 0)

log "Pulled HKG=${hkg_bytes}B SZX=${szx_bytes}B CX=${cx_bytes}B"

# Bail if both HKG and SZX are empty (CX is optional)
if [ "$hkg_bytes" -lt 100 ] && [ "$szx_bytes" -lt 100 ]; then
  log "ERROR: both HKG+SZX files empty, aborting"
  rm -f "$tmp_hkg" "$tmp_szx" "$tmp_cx"
  exit 1
fi

# Update local copies only if non-empty (these become the Vercel static fallback
# at the next code deploy — kept fresh here so when we DO deploy, the fallback
# is up-to-date).
[ "$hkg_bytes" -ge 100 ] && cp "$tmp_hkg" "$APP_DIR/src/data/all_dates.json"
[ "$szx_bytes" -ge 100 ] && cp "$tmp_szx" "$APP_DIR/src/data/all_dates_szx.json"
[ "$cx_bytes"  -ge 100 ] && cp "$tmp_cx"  "$APP_DIR/src/data/all_dates_cx.json" || log "WARN: CX file empty/missing — skipping (CX block will be omitted this run)"
rm -f "$tmp_hkg" "$tmp_szx" "$tmp_cx"

log "Local files updated (no git push). Run 'cd $APP_DIR && git status' to see pending changes."
