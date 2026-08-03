"""
Comparetiger Futu News Bot — end-to-end orchestrator.

Reads the Futu 48h news sitemap, skips articles we've already posted,
optionally browser-fetches each article body (Playwright headless
Chromium), rewrites each one (TC normalization + opinion filter +
per-section summary), and POSTs a draft to the Comparetiger WordPress
site.

Defaults to "draft" so you can review before publishing. Pass --publish
to publish immediately (not recommended for first run).

Usage:
    python3 main.py             # post up to 5 drafts, stop on error
    python3 main.py --limit 10  # post up to 10 drafts
    python3 main.py --dry-run   # show what would be posted, post nothing
    python3 main.py --publish   # publish immediately (skip draft stage)
    python3 main.py --no-body   # skip browser fetch (sitemap-only mode)
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import rewrite
import sitemap
import wp

# body_fetcher is optional — only import when actually needed so this
# module can be imported by tools that don't have Playwright installed
# (e.g. on the Mac development machine).


def _extract_post_id(resp: dict) -> int | None:
    if not isinstance(resp, dict):
        return None
    # WP REST returns {"id": 12345, ...} for posts
    if "id" in resp and isinstance(resp["id"], int):
        return resp["id"]
    return None


def _extract_post_url(resp: dict) -> str | None:
    if not isinstance(resp, dict):
        return None
    return resp.get("link") or resp.get("guid", {}).get("rendered")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Comparetiger Futu News Bot — fetch, rewrite, post drafts."
    )
    parser.add_argument(
        "--limit", type=int, default=5, help="Max drafts to create this run"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute the would-be drafts but don't POST anything",
    )
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Publish immediately instead of leaving as draft",
    )
    parser.add_argument(
        "--retag", action="store_true", help="Reprocess already-seen URLs"
    )
    parser.add_argument(
        "--max-age-minutes",
        type=int,
        default=120,
        help="Skip articles older than this (default 120 min = 2h)",
    )
    parser.add_argument(
        "--no-body",
        action="store_true",
        help="Skip browser fetch — sitemap-only (title + link). Faster but thinner.",
    )
    args = parser.parse_args()

    if not args.dry_run and not os.environ.get("COMPRETIGER_WP_PASSWORD"):
        print("COMPRETIGER_WP_PASSWORD env var is required", file=sys.stderr)
        return 2

    if args.publish and args.dry_run:
        print("--publish and --dry-run are mutually exclusive", file=sys.stderr)
        return 2

    print(f"[start] fetching sitemap…", flush=True)
    articles = sitemap.fetch_sitemap_urls()
    print(f"[ok] sitemap has {len(articles)} articles", flush=True)

    seen = set() if args.retag else sitemap.load_seen()
    new = sitemap.filter_new(articles, seen)
    print(
        f"[ok] {len(new)} new articles (seen: {len(seen)}, retag={args.retag})",
        flush=True,
    )

    # Age filter — only post recent news
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).timestamp()
    fresh = []
    for a in new:
        try:
            dt = datetime.fromisoformat(a.published_at.replace("Z", "+00:00"))
            age_min = (now - dt.timestamp()) / 60.0
            if age_min <= args.max_age_minutes:
                fresh.append(a)
        except Exception:
            # If we can't parse, include it (don't silently drop)
            fresh.append(a)
    print(
        f"[ok] {len(fresh)} within last {args.max_age_minutes}m age window",
        flush=True,
    )

    # Lazy-import body_fetcher only when --no-body is NOT set
    body_fetcher = None
    if not args.no_body:
        try:
            import body_fetcher as body_fetcher
        except ImportError as e:
            print(
                f"[warn] could not import body_fetcher ({e}); falling back to "
                f"--no-body mode",
                file=sys.stderr,
                flush=True,
            )

    posted_ids: list[tuple[str, int | None]] = []
    new_seen = set(seen)

    for i, article in enumerate(fresh[: args.limit]):
        # Try to fetch the body via headless browser
        body = None
        if body_fetcher is not None:
            t0 = time.time()
            body = body_fetcher.fetch_body(article.canonical_url)
            dt = time.time() - t0
            if body is None:
                print(
                    f"[body] [{i}] fetch failed ({dt:.1f}s) — posting title-only",
                    flush=True,
                )
            else:
                print(
                    f"[body] [{i}] {len(body.sections)} sections, "
                    f"{body.total_chars} chars ({dt:.1f}s)",
                    flush=True,
                )

        payload = rewrite.rewrite(article, body=body)
        if payload is None:
            print(f"[skip] [{i}] too thin / opinion — {article.title[:60]}", flush=True)
            new_seen.add(article.url)
            continue

        if args.publish:
            payload["status"] = "publish"

        if args.dry_run:
            print(
                f"[dry-run] would POST [{i}] [{article.source}] "
                f"{payload['title'][:60]}",
                flush=True,
            )
            new_seen.add(article.url)
            continue

        print(
            f"[post] [{i}] [{article.source}] {payload['title'][:60]}…",
            flush=True,
        )
        status, resp = wp.post_draft(payload)
        if 200 <= status < 300:
            pid = _extract_post_id(resp)
            link = _extract_post_url(resp)
            print(f"  ✓ HTTP {status} post_id={pid} link={link}", flush=True)
            posted_ids.append((article.url, pid))
            new_seen.add(article.url)
        else:
            print(f"  ✗ HTTP {status}: {str(resp)[:300]}", file=sys.stderr, flush=True)
            # Don't mark as seen — we'll retry next run
            break  # Stop on first error to avoid hammering with bad auth

        # Be polite to WP REST
        time.sleep(0.5)

    # Persist seen set even on partial failure
    if not args.dry_run:
        sitemap.save_seen(new_seen)

    # Clean up the browser singleton
    if body_fetcher is not None:
        try:
            body_fetcher.close_browser()
        except Exception:
            pass

    print(
        f"\n[done] posted={len(posted_ids)} seen_total={len(new_seen)}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())