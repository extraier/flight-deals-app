"""
Post drafts to Comparetiger (WordPress) via WP REST with app-password auth.

Reuses the same auth pattern as the existing wp_post_iframe.py. Auth
credentials live in environment variables (will be set by the launchd
plist — see install.sh).

Env vars required:
    COMPRETIGER_WP_USER       (default: "Comparetiger")
    COMPRETIGER_WP_PASSWORD   (required, app-password string)
    COMPRETIGER_WP_BASE       (default: "https://comparetiger.com")
"""
from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request

WP_BASE = os.environ.get("COMPRETIGER_WP_BASE", "https://comparetiger.com")
WP_USER = os.environ.get("COMPRETIGER_WP_USER", "Comparetiger")
WP_PASSWORD = os.environ.get("COMPRETIGER_WP_PASSWORD", "")


def _auth_header() -> str:
    creds = f"{WP_USER}:{WP_PASSWORD}".encode()
    return "Basic " + base64.b64encode(creds).decode()


def _request(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    url = f"{WP_BASE}/?rest_route={path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": _auth_header(),
            "Content-Type": "application/json",
            "User-Agent": "comparetiger-futu-news-bot/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(payload)
            except Exception:
                return resp.status, {"_raw": payload[:400]}
    except urllib.error.HTTPError as e:
        payload = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(payload)
        except Exception:
            return e.code, {"_raw": payload[:400]}


def post_draft(payload: dict) -> tuple[int, dict]:
    """Create a new WP draft post. Returns (status_code, response_json)."""
    return _request("POST", "/wp/v2/posts", payload)


def get_post(post_id: int) -> tuple[int, dict]:
    return _request("GET", f"/wp/v2/posts/{post_id}")


def list_recent_drafts(limit: int = 5) -> tuple[int, dict]:
    """List recent posts with status=draft to verify our drafts exist."""
    return _request(
        "GET",
        f"/wp/v2/posts&per_page={limit}&status=draft&orderby=date&order=desc",
    )


def health() -> tuple[int, dict]:
    """Lightweight liveness check — list 1 post in any state."""
    return _request("GET", "/wp/v2/posts&per_page=1")


if __name__ == "__main__":
    if not WP_PASSWORD:
        print("COMPRETIGER_WP_PASSWORD env var is required", file=sys.stderr)
        sys.exit(2)

    code, body = health()
    print(f"health: HTTP {code}")
    print(f"body: {json.dumps(body, ensure_ascii=False, indent=2)[:800]}")