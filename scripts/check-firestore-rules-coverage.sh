#!/usr/bin/env bash
# scripts/check-firestore-rules-coverage.sh
#
# Verify the LIVE Firestore ruleset on savetheday-2377a contains the
# flight-deals-app couple-rooms rules. Runs as a CI gate + daily cron.
#
# Exits:
#   0 — coverage OK (active ruleset has coupleRooms + coupleSpots + coupleAds match blocks)
#   1 — coverage FAIL (wedding app deploy clobbered our rules)
#   2 — setup error (gcloud not authenticated, firebaserules disabled, etc.)
#
# Usage:
#   ./scripts/check-firestore-rules-coverage.sh
#   ./scripts/check-firestore-rules-coverage.sh --strict   # fail on ANY missing block
#
# Required: gcloud authenticated, firebaserules.googleapis.com enabled on project.
# See: skills/firestore-rules-shadow-pitfalls §Class 34 + §Pre-flight gates.

set -euo pipefail

PROJECT="${FIREBASE_PROJECT:-savetheday-2377a}"
STRICT=0
[[ "${1:-}" == "--strict" ]] && STRICT=1

echo "[check-firestore-rules-coverage] project=$PROJECT strict=$STRICT"

# ─── Gate 1: gcloud actually working ──────────────────────────────────────────
# Mac system Python 3.9 with gcloud silently returns empty output.
# Verify before trusting any gcloud output.
if [[ -z "${CLOUDSDK_PYTHON:-}" ]]; then
    if command -v /opt/homebrew/bin/python3.14 >/dev/null 2>&1; then
        export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14
        echo "[gcloud] using CLOUDSDK_PYTHON=$CLOUDSDK_PYTHON"
    fi
fi

ACCT=$(gcloud config get-value account 2>/dev/null || true)
if [[ -z "$ACCT" ]]; then
    echo "✗ gcloud not authenticated or CLOUDSDK_PYTHON broken (account=$ACCT)"
    echo "  Fix: export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14 && gcloud auth login"
    exit 2
fi
echo "[gcloud] account=$ACCT"

# ─── Gate 2: firebaserules.googleapis.com enabled ─────────────────────────────
if ! gcloud services list --enabled --project="$PROJECT" 2>/dev/null | grep -q firebaserules.googleapis.com; then
    echo "✗ firebaserules.googleapis.com NOT enabled on $PROJECT"
    echo "  Fix: gcloud services enable firebaserules.googleapis.com --project=$PROJECT"
    exit 2
fi

# ─── Fetch active ruleset + content ───────────────────────────────────────────
TOKEN=$(gcloud auth print-access-token)
ACTIVE=$(curl -sf \
    "https://firebaserules.googleapis.com/v1/projects/$PROJECT/releases/cloud.firestore" \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-goog-user-project: $PROJECT" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['rulesetName'].split('/')[-1])")

echo "[ruleset] active=$ACTIVE"

ACTIVE_CONTENT=$(curl -sf \
    "https://firebaserules.googleapis.com/v1/projects/$PROJECT/rulesets/$ACTIVE" \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-goog-user-project: $PROJECT" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['source']['files'][0]['content'])")

ACTIVE_LEN=${#ACTIVE_CONTENT}
ACTIVE_SHA=$(printf '%s' "$ACTIVE_CONTENT" | shasum -a 256 | cut -d' ' -f1)
echo "[ruleset] size=${ACTIVE_LEN} bytes sha256=${ACTIVE_SHA:0:16}..."

# ─── Coverage checks ──────────────────────────────────────────────────────────
# These signatures MUST appear in the active ruleset for flight-deals-app to work.
declare -a REQUIRED=(
    "match /coupleSpots/"          # public spot directory
    "match /coupleRooms/"          # room game state
    "match /coupleAds/"            # trailing ads
    "function isInRoom"            # couple helper
    "function isJoiningRoom"       # couple helper
    "function isSwipingOwn"        # couple helper
)

declare -a OPTIONAL=(
    "match /coupleSpotReactions/"  # if used
)

FAIL=0
echo
echo "─── Required coverage ───"
for sig in "${REQUIRED[@]}"; do
    if printf '%s' "$ACTIVE_CONTENT" | grep -qF "$sig"; then
        printf "  ✓ %s\n" "$sig"
    else
        printf "  ✗ %s MISSING\n" "$sig"
        FAIL=1
    fi
done

echo
echo "─── Optional coverage ───"
for sig in "${OPTIONAL[@]}"; do
    if printf '%s' "$ACTIVE_CONTENT" | grep -qF "$sig"; then
        printf "  ✓ %s\n" "$sig"
    else
        printf "  - %s (not used)\n" "$sig"
    fi
done

# ─── Compare to local firestore.rules if present ──────────────────────────────
LOCAL_FILE=""
for f in firestore.rules ../firestore.rules ../../firestore.rules; do
    [[ -f "$f" ]] && LOCAL_FILE="$f" && break
done

if [[ -n "$LOCAL_FILE" ]]; then
    LOCAL_SHA=$(shasum -a 256 < "$LOCAL_FILE" | cut -d' ' -f1)
    echo
    echo "─── Local vs deployed ───"
    echo "  local:    $LOCAL_FILE sha256=${LOCAL_SHA:0:16}..."
    echo "  deployed: sha256=${ACTIVE_SHA:0:16}..."
    if [[ "$LOCAL_SHA" == "$ACTIVE_SHA" ]]; then
        echo "  ✓ MATCH"
    else
        echo "  ✗ MISMATCH — local rules differ from active ruleset"
        echo "    Likely: wedding app deployed since last flight-deals-app rules sync"
        echo "    Fix: ./scripts/merge-rulesets.sh"
        if [[ "$STRICT" == "1" ]]; then
            FAIL=1
        else
            echo "    (Non-strict mode: warning only. Pass --strict to fail.)"
        fi
    fi
fi

echo
if [[ $FAIL -eq 0 ]]; then
    echo "✓ Coverage OK"
    exit 0
else
    echo "✗ Coverage FAILED — flight-deals-app rules are missing from active ruleset"
    echo "  Recovery: ./scripts/merge-rulesets.sh"
    exit 1
fi