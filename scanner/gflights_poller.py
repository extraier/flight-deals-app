"""
Google Flights digest poller.

Polls Gmail for noreply-travel@google.com digest emails, parses them
using gflights_parser, and writes the result to
src/data/gflights_digest.json.

OAuth setup (one-time, see SETUP_GMAIL_OAUTH.md):
  1. Create a Google Cloud project
  2. Enable Gmail API
  3. Create OAuth 2.0 credentials (Desktop app)
  4. Download credentials.json to this directory
  5. Run: python gflights_poller.py --auth  (one-time, opens browser)
  6. token.json is created with refresh token

Usage:
  python gflights_poller.py                  # poll and write JSON
  python gflights_poller.py --auth           # one-time OAuth consent
  python gflights_poller.py --dry-run        # print without writing
  python gflights_poller.py --days 7         # look back N days (default 7)

Environment:
  GFLIGHTS_OUTPUT_PATH  override output JSON path (default ../src/data/gflights_digest.json)
  GFLIGHTS_CREDENTIALS  override credentials.json path
  GFLIGHTS_TOKEN        override token.json path
"""

import argparse
from typing import List
import base64
import json
import os
import sys
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

# Google API client (optional - only required for --auth or actual polling)
try:
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    HAS_GOOGLE = True
except ImportError:
    HAS_GOOGLE = False

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(SCRIPT_DIR)  # flight-deals-app/
DEFAULT_OUTPUT = os.path.join(DATA_DIR, "src", "data", "gflights_digest.json")
DEFAULT_CREDENTIALS = os.path.join(SCRIPT_DIR, "gflights_credentials.json")
DEFAULT_TOKEN = os.path.join(SCRIPT_DIR, "gflights_token.json")

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

sys.path.insert(0, SCRIPT_DIR)
from gflights_parser import parse_email  # noqa: E402


def authenticate(credentials_path: str, token_path: str):
    """Run one-time OAuth consent flow. Saves token.json for future use."""
    if not HAS_GOOGLE:
        print("ERROR: google-api-python-client not installed.")
        print("Run: pip install google-api-python-client google-auth-oauthlib")
        sys.exit(1)
    if not os.path.exists(credentials_path):
        print(f"ERROR: {credentials_path} not found.")
        print("Download OAuth 2.0 credentials from Google Cloud Console:")
        print("  https://console.cloud.google.com/apis/credentials")
        print("Create a Desktop app credential, save as gflights_credentials.json")
        sys.exit(1)

    flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
    creds = flow.run_local_server(port=0)
    with open(token_path, "w") as f:
        f.write(creds.to_json())
    print(f"✓ Token saved to {token_path}")


def get_service(credentials_path: str, token_path: str):
    """Return an authenticated Gmail API service."""
    if not HAS_GOOGLE:
        print("ERROR: google-api-python-client not installed.")
        sys.exit(1)
    creds = None
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            with open(token_path, "w") as f:
                f.write(creds.to_json())
        else:
            print("No valid credentials. Run: python gflights_poller.py --auth")
            sys.exit(1)
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def extract_body(payload: dict) -> str:
    """Recursively walk a Gmail message payload and return the plain-text body."""
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
    if mime == "text/html" and not payload.get("parts"):
        # Only fall back to HTML if there's no multipart alternative
        data = payload.get("body", {}).get("data", "")
        if data:
            html = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
            return html_to_text(html)
    for part in payload.get("parts", []):
        text = extract_body(part)
        if text:
            return text
    return ""


def html_to_text(html: str) -> str:
    """Crude HTML to plain text. Strips tags and decodes entities."""
    # Remove scripts/styles
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    # Replace block-level tags with newlines
    html = re.sub(r"</?(div|p|br|tr|li|h[1-6])[^>]*>", "\n", html, flags=re.IGNORECASE)
    # Strip remaining tags
    html = re.sub(r"<[^>]+>", "", html)
    # Decode common entities
    html = html.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    html = html.replace("&#x27;", "'").replace("&#39;", "'").replace("&quot;", '"')
    # Collapse whitespace within lines, but preserve newlines
    lines = []
    for line in html.split("\n"):
        line = re.sub(r"[ \t]+", " ", line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def list_gflights_message_ids(service, days: int) -> list:
    """List message IDs from noreply-travel@google.com in the last N days."""
    after_ts = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())
    query = f"from:noreply-travel@google.com after:{after_ts}"
    result = service.users().messages().list(userId="me", q=query, maxResults=500).execute()
    return [m["id"] for m in result.get("messages", [])]


def get_message(service, msg_id: str) -> dict:
    """Fetch a full message and return {headers, body, view_links, internal_date}."""
    msg = service.users().messages().get(userId="me", id=msg_id, format="full").execute()
    headers = {}
    for h in msg.get("payload", {}).get("headers", []):
        name = h["name"].lower()
        if name in ("from", "subject", "date", "message-id"):
            headers[name] = h["value"]
    payload = msg.get("payload", {})
    body = extract_body(payload)
    # Hermes 2026-10-17: extract View links from the HTML part so the parser
    # can pair them with deals in body-text order. Each c.gle URL resolves
    # (via Google redirect) to the actual Google Flights search URL with
    # origin/destination/dates/airline/cabin — that's what the user clicks
    # through to. We store the c.gle directly and let the browser follow.
    view_links = extract_view_links(payload)
    # Hermes 2026-10-18: also extract the message's send timestamp so the UI
    # can show "alert sent at 20:00" on each card. internalDate is the
    # authoritative GMT ms; we keep both the raw Date header (preserves
    # Google's timezone) and the parsed form.
    internal_date = int(msg.get("internalDate", "0") or 0)
    return {
        "headers": headers,
        "body": body,
        "view_links": view_links,
        "internal_date_ms": internal_date,
        "date_header": headers.get("date", ""),
        "raw": msg,
    }


def extract_view_links(payload: dict) -> List[str]:
    """Recursively walk a Gmail message payload and return the c.gle/Google
    Flights URLs from <a> elements whose visible text is exactly "View".
    URLs are returned in document order so the parser can pair them with
    deals by index."""
    return _extract_view_links_recursive(payload, [])


def _extract_view_links_recursive(payload: dict, acc: List[str]) -> List[str]:
    mime = payload.get("mimeType", "")
    if mime == "text/html":
        data = payload.get("body", {}).get("data", "")
        if data:
            try:
                html = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
            except Exception:
                html = ""
            # Find each <a ... href="URL" ...>View</a>
            for m in re.finditer(
                r'<a[^>]+href="([^"]+)"[^>]*>\s*View\s*</a>',
                html, flags=re.IGNORECASE,
            ):
                href = m.group(1)
                # Only c.gle and direct google.com/travel/flights URLs count
                if 'c.gle/' in href or 'google.com/travel/flights' in href:
                    acc.append(href)
    for part in payload.get("parts", []):
        _extract_view_links_recursive(part, acc)
    return acc


def load_existing(path: str) -> dict:
    """Load existing digest JSON or initialize."""
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {
        "generated": None,
        "source": "gmail://noreply-travel@google.com",
        "deals": [],
        "messages": [],
    }


def merge_deals(existing: dict, new_deals: list) -> dict:
    """Dedupe by (origin, dest, dep_date). Keep the most recent first_seen."""
    def _key(d):
        # Hermes 2026-10-18: the parsed deal uses 'destination_name' (matching
        # the API/UI shape); the dedup key needs to be tolerant of both so we
        # don't crash when an existing deal has either field.
        dest = d.get("destination_name") or d.get("destination") or ""
        return (d.get("origin", ""), dest, d.get("dep_date", ""))
    by_key = {}
    for d in existing.get("deals", []):
        by_key[_key(d)] = d
    for d in new_deals:
        key = _key(d)
        existing_d = by_key.get(key)
        if not existing_d or d.get("first_seen", "") > existing_d.get("first_seen", ""):
            by_key[key] = d
    sorted_deals = sorted(
        by_key.values(),
        key=lambda x: (x.get("first_seen", ""), x.get("min_price", 0)),
        reverse=True,
    )
    return {
        "generated": datetime.now(timezone.utc).isoformat(),
        "source": "gmail://noreply-travel@google.com",
        "deals": sorted_deals,
        "count": len(sorted_deals),
    }


def flatten_for_api(parsed: dict, message_id: str = None, alert_date_iso = None, alert_unix_ms = None) -> dict:
    """Flatten a parsed email into the API shape (one entry per deal).

    alert_date_iso / alert_unix_ms are the Gmail message's send time so the
    UI can render "alert sent at 2026-10-17 20:00" on each card. Same
    value for every deal in the same digest (they all come from the
    same email).
    """
    flat = []
    for d in parsed.get("deals", []):
        # Build dep_date in YYYY-MM-DD format
        dep_year = parsed.get("prices_updated", "")[:4] if parsed.get("prices_updated") else ""
        if not dep_year:
            dep_year = str(datetime.now().year)
        try:
            month_num = {
                "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
                "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
            }[d["dep_month"]]
            dep_date = f"{dep_year}-{month_num:02d}-{d['dep_day']:02d}"
        except (KeyError, TypeError):
            dep_date = ""
        flat.append({
            "id": f"gflights-{parsed['origin'][:3].upper()}-{parsed['destination'][:20]}-{dep_date}".replace(" ", ""),
            "source": "google_flights",
            "origin": parsed["origin"],
            "destination_name": parsed["destination"],
            "dep_date": dep_date,
            "date_range": d["date_range"],
            "price_hkd": d.get("price"),
            "save_pct": d.get("save_pct"),
            "airlines": d.get("airlines"),
            "stops": d.get("stops"),
            "duration": d.get("duration"),
            "view_link": d.get("view_link"),  # c.gle redirect → Google Flights
            "trip_label": parsed.get("trip_label"),
            "params": parsed.get("params"),
            "price_range": parsed.get("price_range"),
            "min_price": parsed.get("min_price"),
            "first_seen": parsed.get("parsed_at"),
            "prices_updated": parsed.get("prices_updated"),
            "message_id": message_id,
            # Hermes 2026-10-18: when Google sent the digest. Same for all
            # deals in the email. The ISO string preserves Gmail's
            # reported timezone; the unix ms is the canonical form for
            # sort/filter and date math on the client.
            "alert_date": alert_date_iso,
            "alert_unix_ms": alert_unix_ms,
        })
    return flat


def poll(days: int, dry_run: bool, output_path: str, credentials: str, token: str):
    """Main polling logic."""
    service = get_service(credentials, token)
    msg_ids = list_gflights_message_ids(service, days)
    print(f"Found {len(msg_ids)} messages from noreply-travel@google.com in last {days} days")

    all_deals = []
    for mid in msg_ids:
        msg = get_message(service, mid)
        parsed = parse_email(msg["headers"], msg["body"], view_links=msg.get("view_links", []))
        if parsed is None:
            print(f"  [{mid[:8]}] SKIP: not a Google Flights digest")
            continue
        n = len(parsed.get("deals", []))
        # Hermes 2026-10-18: convert the message's internalDate (Unix ms)
        # into an ISO-8601 string with timezone for the UI.
        alert_unix_ms = msg.get("internal_date_ms")
        if alert_unix_ms:
            alert_date_iso = (
                datetime.fromtimestamp(alert_unix_ms / 1000, tz=timezone.utc).isoformat()
            )
        else:
            alert_date_iso = None
        print(f"  [{mid[:8]}] {parsed['origin']}→{parsed['destination']}: {n} deal(s) (alert={alert_date_iso})")
        flat = flatten_for_api(
            parsed, message_id=mid,
            alert_date_iso=alert_date_iso, alert_unix_ms=alert_unix_ms,
        )
        all_deals.extend(flat)

    print(f"\nTotal deals parsed: {len(all_deals)}")

    if dry_run:
        print("\n[DRY RUN] Not writing to disk. Sample:")
        if all_deals:
            print(json.dumps(all_deals[0], indent=2, ensure_ascii=False))
        return

    existing = load_existing(output_path)
    merged = merge_deals(existing, all_deals)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)
    print(f"✓ Wrote {merged['count']} deals to {output_path}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--auth", action="store_true", help="One-time OAuth consent flow")
    ap.add_argument("--dry-run", action="store_true", help="Don't write to disk")
    ap.add_argument("--days", type=int, default=7, help="Look back N days (default 7)")
    ap.add_argument("--output", default=os.environ.get("GFLIGHTS_OUTPUT_PATH", DEFAULT_OUTPUT))
    ap.add_argument("--credentials", default=os.environ.get("GFLIGHTS_CREDENTIALS", DEFAULT_CREDENTIALS))
    ap.add_argument("--token", default=os.environ.get("GFLIGHTS_TOKEN", DEFAULT_TOKEN))
    args = ap.parse_args()

    if args.auth:
        authenticate(args.credentials, args.token)
    else:
        poll(args.days, args.dry_run, args.output, args.credentials, args.token)
