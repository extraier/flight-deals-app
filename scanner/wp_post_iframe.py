#!/usr/bin/env python3
"""
Push a simple iframe to the CompareTiger WP page 5161 so visitors see
the live Vercel flight-deals-app (instead of a frozen 7/3 hardcoded table).

Trigger: every 10 min via cron / launchd (no Google quota, no scan work).
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

# A self-contained HTML snippet that:
# 1. Latches iframe dimensions to the actual visible viewport (window.innerHeight)
#    so it survives Telegram's iOS WebView, mobile Safari, and any nested-iframe
#    resize events where 100vh reads stale values.
# 2. Disables scroll bars (we host the full app inside).
# 3. Anchors the iframe in a static wrapper so parent WP theme sidebars/footer
#    that survive below are still pushed off via overflow:hidden on html/body.
# The snippet is wrapped in a <p> because WP strips raw <iframe> outside of
# allowed tags inside <p>, but the visual result is identical (the <p> tag
# has zero margin/padding thanks to the styles we inject first).
HTML = f"""<p><iframe id="fdframe" src="{VIEWSITE_URL}" allowfullscreen style="position:fixed;inset:0;width:100vw;height:100vh;border:0;display:block;margin:0;padding:0"></iframe></p>
<style>
  /* Belt-and-braces: hide possible sidebar/footer that survive iframe overflow,
     and disable parent document scroll just in case the iframe is taller than
     viewport for any reason on the parent side. */
  html, body {{ height:100%; margin:0; padding:0; overflow:hidden !important; }}
  body > *:not(.entry-content):not(#content):not(.content):not(main):not(.site-content):not(.site-main):not(.site-container):not(.site):not(.page):not(.wp-site-content):not(.clearfix) {{ display:none !important; }}
  #fdframe {{ height:100vh !important; width:100vw !important; }}
</style>
<script>
  /* Resize observer for browser chrome (URL bar show/hide) and rotation. */
  (function() {{
    function fit() {{
      var f = document.getElementById('fdframe');
      if (!f) return;
      try {{
        var h = window.innerHeight || document.documentElement.clientHeight;
        f.style.height = h + 'px';
      }} catch (e) {{}}
    }}
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    if (window.ResizeObserver) {{
      new ResizeObserver(fit).observe(document.documentElement);
    }}
    /* Run once after load to handle WebView weirdness where innerHeight is
       0 on first paint. */
    setTimeout(fit, 50);
    setTimeout(fit, 500);
  }})();
</script>"""


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
