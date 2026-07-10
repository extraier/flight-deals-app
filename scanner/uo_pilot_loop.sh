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

# Hermes 2026-07-10: startup stagger. The SZX and UO pilots both fire
# validation threads at container boot — 2 workers each = 4 curl_cffi
# sessions at peak = ~120MB extra, which OOM-kills both under the
# 256MB container cgroup limit. Sleeping 70s before round #1 puts
# the UO pilot's validation window after the SZX pilot's, so they
# never validate concurrently. The pause-between-rounds (180s) is
# shorter than a full validation cycle (~120s) so even if a cycle
# runs long, the next pilot's validation starts after the previous
# pool is warmed and idle. Tune UO_STARTUP_DELAY_S=0 if you want
# both pilots to fight it out (not recommended).
UO_STARTUP_DELAY_S="${UO_STARTUP_DELAY_S:-70}"

echo "[$(date)] UO PILOT detail continuous loop starting (pid=$$)"
echo "Script: $SCRIPT"
echo "PILOT_ROUTES: $PILOT_ROUTES"
echo "Pause between rounds: ${SLEEP_BETWEEN_ROUNDS}s"
echo "Startup delay: ${UO_STARTUP_DELAY_S}s (so SZX pilot validates first)"
echo "=========================================="

# Sleep before the first round only — subsequent rounds already stagger
# via SLEEP_BETWEEN_ROUNDS.
sleep "$UO_STARTUP_DELAY_S"

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