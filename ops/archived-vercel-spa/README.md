# Comparetiger 財經新聞 Vercel SPA (archived)

The Vercel SPA at flight-deals-app-seven.vercel.app/news is dead as of
2026-08-03. The Vercel project `flight-deals-app` was deleted, the
alias `flight-deals-app-seven.vercel.app` was removed, and the
launchd-based deploy job was unloaded.

The page now lives at **comparetiger.com/?page_id=10215** as a static
HTML page baked by the cron (`scanner/futu-news-bot/page_baker.py`).

This source is preserved for reference only — it's not deployed.

## Why we moved to WordPress

- **SEO**: All content on comparetiger.com (your domain) boosts
  comparetiger.com's authority. Vercel links boost vercel.app.
- **No Vercel quota**: Static HTML is re-baked by the NAS cron, no
  Vercel deploys needed.
- **No iframe**: Direct URL, no scroll quirks, no JS bundle.
- **WP theme cross-linking**: Related posts, sidebar, breadcrumbs,
  recent comments all automatic.

## What's still relevant

- `news-types.ts` — types + helpers (source colors, time formatter,
  HTML stripper, source-name extractor). Could be moved to
  `components/comparetiger-news/` if you ever want a React/Next.js
  component.

- `news-list.tsx` — the inline-expand client component. Useful pattern
  if you ever build a different SPA.

## How to revert (unlikely)

If you want the Vercel SPA back:
1. Sign up for Vercel, get a token
2. `git mv ops/archived-vercel-spa/* src/app/news/`
3. Update `next.config.js` to include the project
4. Set up GitHub Actions to deploy on push
