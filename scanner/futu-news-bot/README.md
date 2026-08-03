# futu-news-bot — Comparetiger news poster

Fetches the Futu 48h news sitemap, skips articles we've already posted,
rewrites each one in Traditional Chinese with a back-link to the source,
and creates a WordPress **draft** on `comparetiger.com` via WP REST.

## Files
- `sitemap.py` — fetches `https://news.futunn.com/sitemap-news-zhhant-index-test-48hours.xml`
- `rewrite.py` — TC normalization + opinion-filter; builds the WP payload
- `wp.py` — WP REST client (app-password auth via env var)
- `main.py` — orchestrator (fetch → filter → rewrite → POST)

## Config
The WP password is read from the `COMPRETIGER_WP_PASSWORD` env var. See
`install.sh` for the launchd plist that wires it up + runs hourly.

## Run
```sh
export COMPRETIGER_WP_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx"
python3 main.py --dry-run   # preview
python3 main.py --limit 5   # post up to 5 drafts
```

## Idempotency
Seen URLs are persisted in `~/.cache/comparetiger/futu_seen_urls.json`.
Use `--retag` to repost everything.