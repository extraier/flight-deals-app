#!/bin/bash
# Hermes 2026-10-20: wrap gflights_poller.py with auto-deploy.
#
# Problem this fixes: the poller writes gflights_digest.json every hour
# but never deploys. The user reported the 10:29 HKT Rome email landed
# in the JSON at 15:01 HKT but stayed invisible until I manually
# deployed — a 5-hour lag that makes the cron useless.
#
# Fix: this wrapper runs pull → poll → diff → conditional commit/push →
# vercel deploy. The deploy is conditional on the JSON actually
# changing, so idle hours don't churn Vercel.
#
# The wrapper lives in the repo so each commit captures changes.

set -euo pipefail

REPO=/Users/roger/flight-deals-app
LOG=/tmp/gflights_poll_deploy.log
TEAM=team_UHKez9kHl9L94fPGdgP2Uj8i

# Hermes 2026-10-20: launchd runs scripts with a stripped PATH (just
# /usr/bin:/bin:/usr/sbin:/sbin). npx + vercel live in /opt/homebrew/bin
# via npm-prefix, so without this we get exit 127 "command not found"
# on `npx vercel`. Explicit PATH avoids drift across Node versions.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

exec >> "$LOG" 2>&1
echo "==== $(date -u +%FT%TZ) gflights poll+deploy ===="

cd "$REPO"

# 1) Pull latest. Skip if no network — cron is offline-tolerant.
git fetch origin main --quiet 2>&1 | head -3 || true
git merge --ff-only origin/main --quiet 2>&1 | head -3 || true

# 2) Poll Gmail → JSON. /usr/bin/python3 (launchd's default) has the
# user-site google-api-python-client installed.
/usr/bin/python3 scanner/gflights_poller.py

# 3) Check if the JSON changed. If not, skip deploy (saves Vercel churn).
if git diff --quiet src/data/gflights_digest.json; then
  echo "[skip] gflights_digest.json unchanged — no deploy"
  exit 0
fi

echo "[changed] gflights_digest.json has new deals — deploying"

# 4) Commit. Allow-empty disabled so we error if nothing to commit
# (defense in depth vs the git diff above).
git add src/data/gflights_digest.json
git commit -m "Cron pull: new GFlight deals $(date -u +%FT%TZ)
$(git diff --cached --numstat -- src/data/gflights_digest.json | awk '{print $1" insertions, "$2" deletions"}')"

# 5) Push to main. If push fails (e.g. concurrent push), bail out
# without deploying so we don't drift further.
git push origin main 2>&1 | head -5 || {
  echo "[error] git push failed — bailing out, JSON written but not deployed"
  exit 1
}

# 6) Deploy to Vercel prod + reattach custom domain. Each step ~30s,
# worst-case ~90s total on a 1h cadence.
echo "[deploy] starting vercel deploy"
DEPLOY_OUT=$(npx --no-install vercel deploy --prod --yes --team "$TEAM" 2>&1 | tail -20)
echo "$DEPLOY_OUT" | head -20

DEPLOY_URL=$(echo "$DEPLOY_OUT" | grep -oE 'https://flight-deals-[a-z0-9]+-extraiers-projects\.vercel\.app' | head -1)
if [ -z "$DEPLOY_URL" ]; then
  echo "[error] could not parse deploy URL from:"
  echo "$DEPLOY_OUT"
  exit 1
fi

echo "[alias] $DEPLOY_URL → flight.comparetiger.com"
npx --no-install vercel alias set "$DEPLOY_URL" flight.comparetiger.com --team "$TEAM" 2>&1 | tail -5

echo "[done] deployed $DEPLOY_URL"
