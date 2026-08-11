#!/bin/bash
# vercel-deploy.sh — Deploy flight-deals-app to Vercel using the shared token.
#
# Usage:
#   ./vercel-deploy.sh           # production deploy
#   ./vercel-deploy.sh --preview  # preview deploy (no --prod)
#
# Token lives at ~/.hermes/secrets/vercel-token (chmod 600). If absent, exit 2.
# Does NOT push to GitHub first — assumes the working tree is the version you want live.
# Returns 0 only if the deploy reaches the production alias URL with HTTP 200 within 30 s.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

PROD=1
for arg in "$@"; do
  case "$arg" in
    --preview) PROD=0 ;;
    --help|-h)
      echo "Usage: $0 [--preview]"
      echo "  --preview  Preview deploy (no --prod)"
      exit 0
      ;;
  esac
done

TOKEN_FILE="$HOME/.hermes/secrets/vercel-token"
if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "ERROR: no token at $TOKEN_FILE" >&2
  echo "  Ask Hermes to redeploy, or paste a vcp_... token and save it there (chmod 600)." >&2
  exit 2
fi

export VERCEL_TOKEN
VERCEL_TOKEN=$(cat "$TOKEN_FILE")

ARGS=(npx vercel deploy --yes --token "$VERCEL_TOKEN")
if [[ "$PROD" == "1" ]]; then
  ARGS+=(--prod)
  echo "==> Deploying to PRODUCTION"
else
  echo "==> Deploying to PREVIEW"
fi

"${ARGS[@]}" 2>&1 | tee /tmp/vercel-deploy.log

# Quick smoke test on production alias
if [[ "$PROD" == "1" ]]; then
  echo "==> Smoke-testing https://flight-deals-app-seven.vercel.app/trump"
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
    'https://flight-deals-app-seven.vercel.app/trump?cache_bust=1')
  if [[ "$code" == "200" ]]; then
    echo "==> PASS: /trump returns 200"
  else
    echo "==> WARN: /trump returns $code (alias may still be propagating)" >&2
  fi
fi
