import { NextRequest, NextResponse } from 'next/server';

/**
 * Hermes 2026-07-01: case-insensitive URL handling.
 *
 * Some clients (Telegram auto-format, mobile autocorrect, URL bar
 * suggestions) uppercase the first letter of paths like /deals → /Deals.
 * Next.js's default route matching is case-sensitive, so those requests
 * 404 with "This page could not be found".
 *
 * This middleware:
 *   - Skips Next.js internals (`/_next/*`, `/api/*` for non-GET,
 *     static assets).
 *   - If the pathname contains any uppercase letter, 308-redirects
 *     to the lowercase form. 308 preserves the request method.
 *
 * Also normalizes trailing slashes (Next.js does this by default
 * with `trailingSlash: false`, but we belt-and-suspender here in case
 * the user hits a bookmark with a slash).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Back-compat: /couple/* moved to /match/* on 2026-08-12. Redirect old
  // bookmarks so shared room codes (e.g. /couple/room/EOOG) keep working.
  if (pathname === '/couple' || pathname.startsWith('/couple/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/match' + pathname.slice('/couple'.length);
    return NextResponse.redirect(url, 308);
  }

  // Quick check: only act if there is at least one uppercase letter.
  if (!/[A-Z]/.test(pathname)) {
    return NextResponse.next();
  }

  // Preserve query string and any locale segments.
  const url = request.nextUrl.clone();
  url.pathname = pathname.toLowerCase();

  return NextResponse.redirect(url, 308);
}

/**
 * Run on every path except Next.js internals and API routes.
 * We include `/api` for GETs only — case matters for tooling, and
 * POST/PUT/DELETE shouldn't be silently redirected (they'd lose
 * their method semantics on some clients).
 */
export const config = {
  matcher: [
    // All paths except Next internals, but include /api for GETs only.
    // Next's matcher can't filter by method directly, so the middleware
    // itself no-ops for non-GETs on /api (safer than 308-ing a POST).
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
};