# GitHub Actions setup

A CI workflow is committed at `.github/workflows/ci.yml` but **cannot be pushed
via the standard `hermes git push` token** — the OAuth PAT lacks the
`workflow` scope required to create/modify files under `.github/workflows/`.

## Why this happens

GitHub requires explicit `workflow` scope on personal access tokens (or
OAuth apps) to add or update workflow files. The default Hermes / gh CLI
token here only has `repo`, `read:user`, `user:email`, etc.

## How to enable it

Pick one:

  1. **Personal access token (fine-grained)**:
     https://github.com/settings/tokens?type=beta
     - Repository access: only `extraier/flight-deals-app`
     - Permissions → Workflows: **Read and write**
     - Re-encrypt via macOS keychain:
       ```bash
       security delete-generic-password -s 'github_pat_flight-deals-app' 2>/dev/null
       security add-generic-password -s 'github_pat_flight-deals-app' \
         -a 'github' -w 'github_pat_NEW_TOKEN_HERE'
       ```
     - Update `~/.gitconfig` [credential] helper or whichever mechanism
       the local `gh` config uses to point at the new keychain entry.

  2. **Merge via the GitHub web editor** (one-time, no scope change):
     - Open https://github.com/extraier/flight-deals-app/blob/main/.github/workflows/ci.yml
     - If the file doesn't exist on origin yet: copy the contents from
       the local commit `fc5f2fd` and commit via the GitHub web UI.
     - The commit `fc5f2fd` (local-only) carries the workflow definition.

  3. **Ask a teammate with admin scope** to push the workflow.

## What's in the workflow

4 parallel jobs on every PR + push to `main`:

  * `lint` — `npm run lint` (ESLint)
  * `test-cards` — `npm run test:cards` (TypeScript couple-cards tests)
  * `test-alerter` — `npm run test:alerter` (Python send_flight_report.py
    phantom-detection tests, plus a smoke-import to catch syntax errors)
  * `build` — `npm run build` (Next.js production build), depends on the
    three test jobs passing

Cache: `actions/setup-node@v4` and `actions/setup-python@v5` both use the
default cache (npm by package-lock.json, pip by requirements — add
`requirements.txt` to scanner/ if you want pip caching; for now there's
nothing to cache since the test file uses only stdlib).

## Running the tests locally

Before pushing, run the same tests the CI will run:

```bash
npm run test:alerter
npm run test:cards
npm run lint
npm run build   # optional, but catches build regressions
```

If `test:alerter` passes locally, it will pass in CI.
