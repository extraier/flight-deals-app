#!/bin/bash
# UO detail-scan pilot via free proxy pool.
#
# Hermes 2026-07-10: mirrors szx_pilot_loop.sh but for HK Express (UO)
# routes. Activated when /data/uo_pilot.flag exists OR
# UO_PILOT_ENABLED=1 is set in the container env.
#
# Why UO needs proxies too: HK Express routes from HKG are getting
# 429-rate-limited by Google just like SZX routes. The home IP is
# already in Google's normal pattern for HKG→* (fast + reliable) but
# UO routes specifically get hit with rate limits because they're
# less common queries.
#
# To activate:
#   touch /data/uo_pilot.flag
#   docker restart fli-scheduler
# To disable:
#   rm /data/uo_pilot.flag
#   docker restart fli-scheduler
#
# PILOT_ROUTES is a comma-separated list of HKG→XXX codes. Empty =
# scan all UO routes (production mode).

set -e

# When sourced from scheduler_supervisor.sh, these vars already exist
# but we re-export here so the script can also be run manually for
# debugging.
export TZ="${TZ:-Asia/Hong_Kong}"
export PROXY_POOL_ENABLED="${PROXY_POOL_ENABLED:-1}"
export PILOT_ROUTES="${PILOT_ROUTES:-HKG→FUK,HKG→KIX}"

SCRIPT=/data/fli_detail_scan_uo.py
LOG=/data/fli_detail_uo_pilot.log
SLEEP_BETWEEN_ROUNDS="${SLEEP_BETWEEN_ROUNDS:-180}"

echo "[$(date)] UO PILOT detail continuous loop starting (pid=$$)"
echo "Script: $SCRIPT"
echo "PILOT_ROUTES: $PILOT_ROUTES"
echo "Pause between rounds: ${SLEEP_BETWEEN_ROUNDS}s"
echo "=========================================="

while true; do
    echo "[$(date)] === UO PILOT detail round #${ROUND_NUM:-1} starting ==="
    ROUND_START=$(date +%s)
    python3 -u "$SCRIPT" 2>&1 | tee -a "$LOG"
    EXIT=${PIPESTATUS[0]}
    ROUND_END=$(date +%s)
    DURATION=$((ROUND_END - ROUND_START))
    echo "[$(date)] Round done, exit=$EXIT, duration=${DURATION}s. Sleeping ${SLEEP_BETWEEN_ROUNDS}s."
    if [ "$EXIT" -ne 0 ]; then
        echo "[$(date)] WARNING: non-zero exit. Backing off 5 min before retry."
        sleep 300
    else
        sleep "$SLEEP_BETWEEN_ROUNDS"
    fi
    ROUND_NUM=$((ROUND_NUM + 1))
done