#!/usr/bin/env python3
"""
Push a fullscreen iframe to CompareTiger WP page 5161 that wraps
https://flight-deals-app-seven.vercel.app so visitors see the live app.

WP's kses sanitiser strips inline <style>/<script> from page content, so
all dimensions must live in the iframe's `style="..."` attribute (which is
preserved verbatim — only element tags are filtered). The iframe stays
position:fixed at the top of the layout stack so it covers the WP theme's
header, sidebar and footer.
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

# Inline style only — no <style>/<script>. WP kses preserves iframe + style attr.
HTML = (
    '<p><iframe id="fdframe" src="' + VIEWSITE_URL + '" allowfullscreen '
    'scrolling="no" frameborder="0" '
    'style="position:fixed !important;top:0 !important;left:0 !important;'
    'width:100vw !important;height:100vh !important;'
    'min-height:100vh !important;min-width:100vw !important;'
    'border:0 !important;margin:0 !important;padding:0 !important;'
    'display:block !important;z-index:2147483647 !important;'
    'background:#fff !important" loading="eager"></iframe></p>'
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
            "User-Agent": "flight-deals-wp-post-iframe/1.0",
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
    print(f"[start] posting iframe → {VIEWSITE_URL} on WP page {WP_PAGE}", flush=True)
    ok = post_to_wp(HTML)
    sys.exit(0 if ok else 1)
