#!/usr/bin/env python3
"""
Push a meta-refresh redirect to CompareTiger WP page 5161 → Vercel
flight-deals-app.

Why redirect, not iframe:
- Telegram iOS WebView sometimes leaves iframe `position:fixed`
  visually pinned but routes touch scrolls to the parent WP page
  underneath. The user sees the iframe overlay covering everything
  but cannot scroll inside it; the sidebar / footer of WP theme
  respond to gestures instead.
- `<meta http-equiv="refresh">` does away with all of that: the whole
  page becomes Vercel, no iframe, no z-index, no scrolling conflict.

Posts via WP REST using the same app-password auth the previous
fli_4x_daily.py used, so no new credential is required.
"""
import base64
import json
import os
import sys
import urllib.request

WP_USER = "Comparetiger"
WP_APP_PASSWORD = "ohWl WFCL g0rd RwJo kqle Ibep"
WP_PAGE = "5161"
VIEWSITE_URL = "https://flight-deals-app-seven.vercel.app"

HTML = (
    '<meta http-equiv="refresh" content="0; url=' + VIEWSITE_URL + '">\n'
    '<p>Loading <a href="' + VIEWSITE_URL + '">' + VIEWSITE_URL + '</a>…</p>'
)


def post_to_wp(html: str) -> bool:
    url = f"https://comparetiger.com/?rest_route=/wp/v2/pages/{WP_PAGE}"
    credentials = f"{WP_USER}:{WP_APP_PASSWORD}".encode()
    auth = base64.b64encode(credentials).decode()
    data = json.dumps({"content": html}).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/json",
            "User-Agent": "flight-deals-wp-redirect/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8", errors="replace")[:200]
            print(f"[ok] HTTP {resp.status}: {body}", flush=True)
            return resp.status in (200, 201)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        print(f"[err] HTTP {e.code}: {body}", file=sys.stderr, flush=True)
        return False
    except Exception as e:
        print(f"[err] {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        return False


if __name__ == "__main__":
    print(f"[start] posting meta-refresh → " + VIEWSITE_URL + " on WP page " + WP_PAGE, flush=True)
    ok = post_to_wp(HTML)
    sys.exit(0 if ok else 1)
