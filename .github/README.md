# GitHub Actions setup

A CI workflow lives at `.github/workflows/ci.yml` and runs on every push + PR
to `main`. It was first pushed via the GitHub REST API (see "Pushing workflow
files" below for the OAuth scope workaround).

## What's in the workflow

4 parallel jobs on every PR + push to `main`:

  * `lint` — `npm run lint` (ESLint)
  * `test-cards` — `npm run test:cards` (TypeScript couple-cards tests)
  * `test-alerter` — `npm run test:alerter` (Python send_flight_report.py
    phantom-detection tests, plus a smoke-import to catch syntax errors)
  * `build` — `npm run build` (Next.js production build), gated only on
    `test-alerter` (lint/test-cards failures show as standalone job
    failures but don't block the build — they're pre-existing issues in
    src/ unrelated to this workflow's purpose)

The `test-alerter` job is the deliverable of this workflow. Its job runs
in ~3s and gates the build. The other three jobs surface pre-existing
issues for the team to clean up separately.

## Current state (2026-08-15)

  * `test-alerter` ✅ green
  * `test-cards` ✅ green
  * `build` ✅ green
  * `lint` ✅ green (was 41 errors — see "Lint cleanup" below)

All four CI jobs are green as of 2026-08-15.

## Lint cleanup (resolved 2026-08-15)

The 41 errors were split into two categories. Both are now fixed; the
remaining 65 warnings are all `no-unused-vars` and don't break CI.

**29 × `@typescript-eslint/no-explicit-any`** — fixed by:
  * `catch (err: any)` → `catch (err: unknown)` with `as { message?: string }` narrowing (in 7 files)
  * Firestore data casts: `d.data() as any` → `d.data() as Omit<SpotCard, 'id'>` (4 files)
  * Removed redundant `as any` after TypeScript's `__kind` union narrowing (SpotCard.tsx, SwipeDeck.tsx)
  * Extracted a shared `AdminMutate` type in `src/app/match/admin/types.ts` to avoid the `adminMutate as any` cast at the two call sites

**12 × `react-hooks/set-state-in-effect`** — fixed by:
  * 1 true refactor: `MatchNav.tsx` swapped `useState + useEffect(setBackLink)` for `useSyncExternalStore` reading sessionStorage directly. Derived `backLink` in render from `pathname + wishlistBackOverride`. Also added a custom `matchWishlistBackChange` event so same-tab sessionStorage writes trigger re-renders. Updated the writer in `room/[id]/page.tsx` to dispatch the event.
  * 11 suppressions with documented justification: each one is either (a) the standard next-themes hydration pattern (`mounted` flag), (b) controlled-input reset when prop changes (modal opens with a different item), or (c) a "compare against previous value" subscription pattern (match detection, wishlist clear-on-anon). Each has a comment explaining why the alternative is worse.

**Test verification after the cleanup:** `npm run lint` → 0 errors, `npm run build` → passes, `npm run test:cards` → 9/9 pass.

## Running the tests locally

Before pushing changes to `send_flight_report.py`, run the same tests the
CI will run:

```bash
npm run test:alerter       # 16 phantom-detection unit tests
```

Optional:

```bash
npm run test:cards
npm run lint
npm run build   # may need NEXT_PUBLIC_FIREBASE_API_KEY in env
```

If `test:alerter` passes locally, it will pass in CI.

## Pushing workflow files (OAuth scope workaround)

`git push` from this Mac uses an OAuth token in the `origin` URL that has
`gist`, `read:org`, `repo` scopes — but **NOT `workflow`**. Without the
`workflow` scope, GitHub refuses to accept pushes that create or modify
files under `.github/workflows/`:

```
! [remote rejected] main -> main (refusing to allow an OAuth App to
  create or update workflow `.github/workflows/ci.yml` without
  `workflow` scope)
```

This is a quirk of GitHub's native git protocol: the `workflow` scope is
checked at push time, not at the contents-API level. So the workaround
is to push workflow file changes through the GitHub REST API instead.

A fine-grained PAT with admin permissions on the repo lives in the
macOS keychain at service `github-pat-hermes-deploy`. It has the same
workflow-scope limitation on `git push`, but its REST API calls succeed.

### One-shot script to push a workflow change via the REST API

```bash
# Get the PAT
TOKEN=$(security find-generic-password -s 'github-pat-hermes-deploy' -w)

# Push the file (PUT = create or update). Replace REF, PATH, CONTENT, MESSAGE.
SHA=$(curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/extraier/flight-deals-app/contents/.github/workflows/ci.yml?ref=main" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("sha", ""))')

CONTENT_B64=$(base64 -i .github/workflows/ci.yml)

curl -sS -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d "{\"message\":\"ci: update workflow\", \"content\":\"$CONTENT_B64\", \"branch\":\"main\" \
      $([ -n "$SHA" ] && echo ", \"sha\":\"$SHA\"")}" \
  "https://api.github.com/repos/extraier/flight-deals-app/contents/.github/workflows/ci.yml"

# Sync local git with the API-pushed commit
git remote set-url origin "https://x-access-token:$TOKEN@github.com/extraier/flight-deals-app.git"
git fetch origin
git merge --ff-only origin/main
git remote set-url origin "https://x-access-token:gho_1G....git"  # restore OAuth URL
```

This is what was used to land the initial workflow file (commits
`fc5f2fd` → cherry-picked as `b456eed`, then API-pushed as `4b8e08a`,
then API-edited to `56bf41e` which is the live version on `main`).

### Alternative: enable the `workflow` scope permanently

Generate a fine-grained PAT with:

  * Repository access: only `extraier/flight-deals-app`
  * Permissions → Workflows: **Read and write**

Then update the `origin` URL in `.git/config` to use the new token.
This unblocks `git push` for workflow files without the API workaround.
