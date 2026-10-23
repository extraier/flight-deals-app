#!/bin/bash
# Hermes 2026-10-24: wrap gflights_poller.py with auto-publish.
#
# Problem this fixes: the poller writes gflights_digest.json every hour
# but never publishes. The user reported the 10:29 HKT Rome email landed
# in the JSON at 15:01 HKT but stayed invisible until I manually
# deployed — a 5-hour lag that makes the cron useless.
#
# Hermes 2026-10-24 — three corrections to the previous version:
#
#   1. DROPPED the `npx vercel deploy --prod` step. The Vercel project's
#      GitHub integration already has productionBranch=main, so every
#      `git push origin main` triggers a production deploy by itself.
#      The explicit deploy was a DUPLICATE build of the same commit —
#      pure waste. It also failed silently from 2026-10-22 08:22 onward
#      (84 consecutive runs), because `npx --no-install` can no longer
#      resolve vercel@65.2.0 from the npm cache. Every one of those
#      failures meant the custom-domain aliases were never re-attached.
#
#   2. Replaced the CLI with the REST API. No npx, no npm cache, no
#      Node-version drift. Uses the token already on disk.
#
#   3. This script now REPAIRS the aliases rather than deploying. After
#      the git push, Vercel's GitHub integration produces a new
#      production deployment — but the manually-created aliases
#      (flight.comparetiger.com, flight-deals-app-seven.vercel.app) do
#      NOT auto-track production and stay pinned to whatever deployment
#      they were last attached to. That is the "stale alias" bug
#      (see skill: vercel-custom-domain-stale-alias). This step finds
#      the newest production deployment and re-attaches both aliases
#      to it, so the site never serves a stale bundle again.
#
# The wrapper lives in the repo so each commit captures changes.

set -euo pipefail

REPO=/Users/roger/flight-deals-app
LOG=/tmp/gflights_poll_deploy.log
TEAM=team_UHKez9kHl9L94fPGdgP2Uj8i
PROJECT=prj_6eJE6rjCAwZD1o70ZFpxPkSsYjem
TOKEN_FILE="$HOME/.hermes/secrets/vercel-token"
API=https://api.vercel.com

# Hermes 2026-10-20: launchd runs scripts with a stripped PATH (just
# /usr/bin:/bin:/usr/sbin:/sbin). Explicit PATH avoids drift across
# Node versions and keeps /usr/bin/python3 resolvable for the poller.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

exec >> "$LOG" 2>&1
echo "==== $(date -u +%FT%TZ) gflights poll+publish ===="

cd "$REPO"

# 1) Pull latest. Skip if no network — cron is offline-tolerant.
git fetch origin main --quiet 2>&1 | head -3 || true
git merge --ff-only origin/main --quiet 2>&1 | head -3 || true

# 2) Poll Gmail → JSON. /usr/bin/python3 (launchd's default) has the
# user-site google-api-python-client installed.
/usr/bin/python3 scanner/gflights_poller.py

# 3) Check if the JSON changed. If not, skip publish (saves Vercel churn).
if git diff --quiet src/data/gflights_digest.json; then
  echo "[skip] gflights_digest.json unchanged — nothing to publish"
  exit 0
fi

echo "[changed] gflights_digest.json has new deals — publishing"

# 4) Commit. Allow-empty disabled so we error if nothing to commit
# (defense in depth vs the git diff above).
git add src/data/gflights_digest.json
git commit -m "Cron pull: new GFlight deals $(date -u +%FT%TZ)
$(git diff --cached --numstat -- src/data/gflights_digest.json | awk '{print $1" insertions, "$2" deletions"}')"

# 5) Push to main. Vercel's GitHub integration deploys main → production
# automatically from this push. If push fails (e.g. concurrent push),
# bail out so we don't drift further.
git push origin main 2>&1 | head -5 || {
  echo "[error] git push failed — bailing out, JSON written but not published"
  exit 1
}

# 6) Wait for Vercel's GitHub integration to finish the production build.
#    The build takes ~40-90s. Poll the deployments list for a READY
#    deployment whose commit sha matches the commit we just pushed.
if [ ! -f "$TOKEN_FILE" ]; then
  echo "[error] vercel token missing at $TOKEN_FILE — cannot repair aliases"
  exit 1
fi
TOKEN=$(tr -d '\n\r' < "$TOKEN_FILE")

SHA=$(git rev-parse HEAD)
echo "[wait] waiting for production deployment of ${SHA:0:8}"

NEW_DEPLOY=""
for attempt in $(seq 1 20); do
  sleep 15
  DEPLOY_JSON=$(curl -sS --max-time 20 \
    -H "Authorization: Bearer $TOKEN" \
    "$API/v6/deployments?projectId=$PROJECT&limit=5&teamId=$TEAM" || true)

  NEW_DEPLOY=$(printf '%s' "$DEPLOY_JSON" | /usr/bin/python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
sha = sys.argv[1]
for x in d.get("deployments", []):
    if (x.get("meta") or {}).get("githubCommitSha", "").startswith(sha):
        if (x.get("state") or x.get("readyState")) == "READY":
            print(x.get("uid") or "")
        break
' "$SHA" 2>/dev/null || true)

  if [ -n "$NEW_DEPLOY" ]; then
    echo "[ready] deployment $NEW_DEPLOY is READY after $((attempt * 15))s"
    break
  fi
  echo "[wait] ... not ready yet ($((attempt * 15))s)"
done

if [ -z "$NEW_DEPLOY" ]; then
  echo "[error] no READY production deployment for ${SHA:0:8} after 300s"
  echo "[error] aliases left pointing at previous deployment"
  exit 1
fi

# 7) Re-attach the custom-domain aliases to the new deployment.
#    These aliases were created manually and do NOT auto-track
#    production, so they must be re-pointed after every deploy.
for ALIAS in flight.comparetiger.com flight-deals-app-seven.vercel.app; do
  RESULT=$(curl -sS --max-time 20 -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"alias\": \"$ALIAS\", \"teamId\": \"$TEAM\"}" \
    "$API/v2/deployments/$NEW_DEPLOY/aliases" 2>&1 || true)
  if printf '%s' "$RESULT" | grep -q '"alias"'; then
    OLD=$(printf '%s' "$RESULT" | /usr/bin/python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("oldDeploymentId", "?")[:24])
except Exception:
    print("?")
' 2>/dev/null || echo "?")
    echo "[alias] $ALIAS → $NEW_DEPLOY (was $OLD)"
  else
    echo "[error] alias re-attach failed for $ALIAS: $RESULT"
  fi
done

echo "[done] published ${SHA:0:8} as $NEW_DEPLOY"
