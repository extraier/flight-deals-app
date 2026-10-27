#!/bin/bash
# Hermes 2026-10-27: REWRITTEN. The app is now self-hosted on the NAS.
#
# WHAT CHANGED
#   Before: poller → git commit + push → Vercel GitHub integration builds a
#           new production deployment → alias repair. That was ONE Vercel
#           deploy per hour, every hour, purely to move a data file. That
#           burned the Hobby quota (~27 deploys/day observed on 2026-10-22
#           through 10-25) and forced the alias-repair dance on every run.
#
#   After:  poller → push the JSON to the NAS → the running Next.js server
#           picks it up from disk on its next cache expiry (5s). No git, no
#           commit, no deploy, no alias repair, no quota.
#
# The site (https://flight.comparetiger.com) is served by the Next.js
# standalone server on the NAS at 127.0.0.1:3000, fronted by a Cloudflare
# Tunnel. Its /api/gflights route reads /volume1/flight-scanner/
# gflights_digest.json directly.
#
# FALLBACK
#   The Vercel deployment is still live and still has the last-known-good
#   bundle. If the NAS push fails, the site keeps serving the previous
#   data from the NAS copy — so a failed push is a no-op, not an outage.
#
# SECRETS
#   The Vercel token is no longer needed here. Kept out of this file
#   entirely so there is nothing to leak.

set -uo pipefail

REPO=/Users/roger/flight-deals-app
LOG=/tmp/gflights_poll_deploy.log

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

exec >> "$LOG" 2>&1
echo "==== $(date -u +%FT%TZ) gflights poll+publish (NAS mode) ===="

cd "$REPO"

# 1) Pull latest code (the poller itself may have been updated).
git fetch origin main --quiet 2>&1 | head -3 || true
git merge --ff-only origin/main --quiet 2>&1 | head -3 || true

# 2) Poll Gmail → JSON. /usr/bin/python3 (launchd's default) has the
#    user-site google-api-python-client installed.
#
#    NOTE (2026-10-27): the OAuth token was revoked on 2026-10-25
#    ("invalid_grant: Token has been expired or revoked"). Until the user
#    re-runs `python3 gflights_poller.py --auth`, this exits non-zero and
#    the digest goes stale. We log it loudly and continue (the push below
#    then pushes the last-known-good file, which is a no-op).
if ! /usr/bin/python3 scanner/gflights_poller.py; then
  echo "[error] poller failed — most likely the Gmail OAuth token needs"
  echo "        re-consent:  cd $REPO/scanner && python3 gflights_poller.py --auth"
  echo "        (the site will keep serving the previous digest until then)"
fi

# 3) Push the freshly-written data files to the NAS. The push script
#    validates JSON locally and writes atomically on the NAS side
#    (tmp file + mv), so a reader never sees a half-written file.
if [ -x "$REPO/scanner/push_data_to_nas.sh" ]; then
  bash "$REPO/scanner/push_data_to_nas.sh"
  PUSH_RC=$?
  if [ "$PUSH_RC" -ne 0 ]; then
    echo "[warn] push_data_to_nas.sh returned $PUSH_RC — check /tmp/fli_data_push.log"
  fi
else
  echo "[error] $REPO/scanner/push_data_to_nas.sh missing or not executable"
  exit 1
fi

# 4) Verify the NAS is actually serving the new data. If the file was
#    pushed, the Next.js /api/gflights route should report a `generated`
#    timestamp matching the local file.
LOCAL_GEN=$(/usr/bin/python3 - <<'PY'
import json
try:
    with open("/Users/roger/flight-deals-app/src/data/gflights_digest.json") as f:
        print(json.load(f).get("generated", ""))
except Exception:
    print("")
PY
)
REMOTE_GEN=$(curl -sS --max-time 20 "https://flight.comparetiger.com/api/gflights" 2>/dev/null \
  | /usr/bin/python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("generated", ""))
except Exception:
    print("")
' 2>/dev/null)

if [ -n "$LOCAL_GEN" ] && [ -n "$REMOTE_GEN" ]; then
  if [ "$LOCAL_GEN" = "$REMOTE_GEN" ]; then
    echo "[ok] NAS is serving the current digest (generated=$LOCAL_GEN)"
  else
    echo "[warn] NAS digest differs — local=$LOCAL_GEN remote=$REMOTE_GEN"
    echo "        (expected for up to ~5s while the 5s in-memory cache expires)"
  fi
else
  echo "[warn] could not compare generated timestamps (local='$LOCAL_GEN' remote='$REMOTE_GEN')"
fi

echo "[done] no git commit, no Vercel deploy — data lives on the NAS"
