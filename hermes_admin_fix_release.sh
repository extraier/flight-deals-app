#!/usr/bin/env bash
# CompareTiger admin remediation release workflow.
# Run from the repository root AFTER implementing the two fixes and Jest tests.
# Default: create a feature branch and pull request. Pass --merge only after
# reviewing the PR and obtaining approval to merge it into production main.

set -Eeuo pipefail

REPO="extraier/flight-deals-app"
BASE_BRANCH="main"
FEATURE_BRANCH="fix/admin-navigation-and-ctr"
MERGE_AFTER_PR=false

if [[ "${1:-}" == "--merge" ]]; then
  MERGE_AFTER_PR=true
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $0 [--merge]" >&2
  exit 64
fi

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: Required command not found: $1" >&2
    exit 127
  }
}

for command in git gh node npm; do require "$command"; done

git rev-parse --show-toplevel >/dev/null
if [[ "$(git rev-parse --show-toplevel)" != "$PWD" ]]; then
  echo "ERROR: Run this script from the repository root." >&2
  exit 2
fi

# Allow only the declared remediation scope. This prevents accidentally
# shipping unrelated work while still allowing Hermes's uncommitted fix files.
ALLOWED_PATHS=(
  "src/app/match/admin/page.tsx"
  "src/components/couple/MatchNav.tsx"
  "src/app/match/room/[id]/page.tsx"
  "src/lib/couple/adminMetrics.ts"
  "src/lib/couple/matchNavigation.ts"
  "src/lib/couple/__tests__/adminMetrics.test.ts"
  "src/lib/couple/__tests__/matchNavigation.test.ts"
  "jest.config.cjs"
  "package.json"
  "package-lock.json"
  "hermes_admin_fix_release.sh"
)

is_allowed_path() {
  local candidate="$1"
  for allowed in "${ALLOWED_PATHS[@]}"; do
    [[ "$candidate" == "$allowed" ]] && return 0
  done
  return 1
}

while IFS= read -r changed_path; do
  [[ -z "$changed_path" ]] && continue
  if [[ "$changed_path" == .github/workflows/* ]]; then
    echo "ERROR: This release includes a GitHub Actions workflow change." >&2
    echo "Configure a token with Workflows: read/write, or use the documented REST API workflow update before rerunning this code-release script." >&2
    exit 2
  fi
  if ! is_allowed_path "$changed_path"; then
    echo "ERROR: Unexpected changed file outside the remediation scope: $changed_path" >&2
    exit 2
  fi
done < <(git status --porcelain | sed -E 's/^.{3}//')

git fetch origin "$BASE_BRANCH" --prune

# Preserve the current implementation changes when moving from main to a
# release branch. Do not reset or discard the working tree.
CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" == "$BASE_BRANCH" ]]; then
  git switch -c "$FEATURE_BRANCH"
elif [[ "$CURRENT_BRANCH" != "$FEATURE_BRANCH" ]]; then
  echo "ERROR: Expected branch '$BASE_BRANCH' or '$FEATURE_BRANCH', found '$CURRENT_BRANCH'." >&2
  exit 2
fi

# The release must include production code, pure helpers, and Jest tests.
REQUIRED_PATHS=(
  "src/app/match/admin/page.tsx"
  "src/components/couple/MatchNav.tsx"
  "src/app/match/room/[id]/page.tsx"
  "src/lib/couple/adminMetrics.ts"
  "src/lib/couple/matchNavigation.ts"
  "src/lib/couple/__tests__/adminMetrics.test.ts"
  "src/lib/couple/__tests__/matchNavigation.test.ts"
  "jest.config.cjs"
  "package.json"
  "package-lock.json"
)

for path in "${REQUIRED_PATHS[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "ERROR: Missing required remediation artifact: $path" >&2
    exit 2
  fi
done

# Install exactly the dependencies pinned in the updated lockfile, then run
# all required local gates before any commit or remote action.
npm ci
npm run lint
npm run test:cards
npm run test:admin -- --runInBand
npm run build
git diff --check

# Refuse a release that lacks the two actual production fixes.
git diff --quiet origin/"$BASE_BRANCH" -- src/app/match/admin/page.tsx && {
  echo "ERROR: Admin CTR production code has not changed from origin/$BASE_BRANCH." >&2
  exit 2
}
git diff --quiet origin/"$BASE_BRANCH" -- src/components/couple/MatchNav.tsx && {
  echo "ERROR: Match navigation production code has not changed from origin/$BASE_BRANCH." >&2
  exit 2
}

# Stage only the declared remediation scope.
git add \
  src/app/match/admin/page.tsx \
  src/components/couple/MatchNav.tsx \
  "src/app/match/room/[id]/page.tsx" \
  src/lib/couple/adminMetrics.ts \
  src/lib/couple/matchNavigation.ts \
  src/lib/couple/__tests__/adminMetrics.test.ts \
  src/lib/couple/__tests__/matchNavigation.test.ts \
  jest.config.cjs package.json package-lock.json

git diff --cached --check
git diff --cached --stat

git commit -m "fix: prevent invalid match links and NaN ad CTR"
git push --set-upstream origin "$FEATURE_BRANCH"

PR_URL="$(gh pr create \
  --repo "$REPO" \
  --base "$BASE_BRANCH" \
  --head "$FEATURE_BRANCH" \
  --title "fix: prevent invalid match links and NaN ad CTR" \
  --body $'## Summary\n- validate persisted room back-links before rendering\n- normalize ad metrics before sort, totals, and CTR display\n- add Jest regressions for malformed storage and incomplete ad records\n\n## Local gates\n- npm run lint\n- npm run test:cards\n- npm run test:admin -- --runInBand\n- npm run build\n\n## Production verification\n- no request to `/match/undefined`\n- no `CTR: NaN%` values in `/match/admin`')"

echo "Pull request created: $PR_URL"

echo "Waiting for GitHub Actions to report the current status..."
gh pr checks "$PR_URL" --watch

if [[ "$MERGE_AFTER_PR" == "true" ]]; then
  echo "Merging the approved pull request into production main..."
  gh pr merge "$PR_URL" --squash --delete-branch
  git switch "$BASE_BRANCH"
  git pull --ff-only origin "$BASE_BRANCH"
  echo "Merged. Confirm the Vercel production deployment for the resulting main commit, then run the browser smoke test in the Hermes handoff."
else
  echo "PR is ready. Review it, wait for all required checks, then rerun with --merge only when authorized to release to production."
fi
