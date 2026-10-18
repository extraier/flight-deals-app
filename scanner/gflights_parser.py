"""
Google Flights digest email parser.

Parses the "tracked route" digest emails sent by
noreply-travel@google.com into structured deal data.

The Gmail API returns the raw .eml (RFC 822) content. This parser
works against the email body's plain-text part. View links (which
contain the actual Google Flights search URL via c.gle redirect)
are passed in from the HTML body and paired with deals by order.

It extracts:
  - Subject: "Your tracked route: {ORIGIN} to {DEST} flights from HK${PRICE}"
  - Trip label: "{N}-week trips in {MONTH}"
  - Trip params: "{N}–{N} days · Round trip · 1 adult · Economy"
  - N deals, each with date range, price, save %, airline, stops, route, duration
  - View link (c.gle redirect → resolves to Google Flights search)
  - Historical price range: HK${LOW} - HK${HIGH}
  - "Prices updated" timestamp

Usage:
    from gflights_parser import parse_email
    result = parse_email(headers={"subject": "...", "from": "..."},
                          body="...",
                          view_links=["https://c.gle/...", ...])
"""

import re
import json
from datetime import datetime, timezone, timedelta
from typing import Optional, List

# Email is from Google Flights
SENDER_PATTERNS = [
    "noreply-travel@google.com",
    "Google Flights <noreply-travel@google.com>",
]

# Subject: "Your tracked route: Hong Kong to Las Vegas flights from HK$7,138"
SUBJECT_RE = re.compile(
    r"Your tracked route:\s+"
    r"(?P<origin>[A-Z][a-zA-Z\s]+?)\s+to\s+"
    r"(?P<dest>.+?)\s+flights?\s+from\s+"
    r"(?:HK\$|NT\$|US\$|\$|€|£|¥)\s*(?P<min_price>[\d,]+)",
    re.IGNORECASE,
)

# Date range: "Thu, Dec 24 – Thu, Dec 31" (uses en-dash or hyphen)
DATE_RE = re.compile(
    r"^(?P<dow1>[A-Z][a-z]{2}),\s+"
    r"(?P<mon1>[A-Z][a-z]{2})\s+(?P<day1>\d{1,2})\s*"
    r"[–—-]\s*"
    r"(?P<dow2>[A-Z][a-z]{2}),\s+"
    r"(?P<mon2>[A-Z][a-z]{2})\s+(?P<day2>\d{1,2})$"
)

# Price line: "SAVE 18%From HK$9,082" or "From HK$9,082"
PRICE_RE = re.compile(
    r"^(?:SAVE\s+(?P<save_pct>\d+)\s*%\s*)?"
    r"From\s+(?:HK\$|NT\$|US\$|\$|€|£|¥)\s*"
    r"(?P<price>[\d,]+)"
)

# Airline: "China Airlines, Delta · 2 stops · HKG–MIA · 24 hr"
# Or:     "Hong Kong Express · Nonstop · HKG–TPE · 2 hr"
# Hermes 2026-10-18: Google uses "Nonstop" for direct flights and "N stops"
# for connections. Two named groups for the stops count + a separate
# "stops_text" group for the raw word ("Nonstop" / "1 stop" / "2 stops")
# so the UI can show "直航" / "轉機 1 次" etc.
AIRLINE_RE = re.compile(
    r"^(?P<airlines>.+?)\s*·\s*"
    r"(?:"
    r"(?P<nonstop>Nonstop)"
    r"|"
    r"(?P<stops>\d+)\s*stops?"
    r")"
    r"\s*·\s*"
    r"(?P<route_from>[A-Z]{3})\s*[–\-—]\s*(?P<route_to>[A-Z]{3})\s*·\s*"
    r"(?P<duration>\d+)\s*hr$"
)

# Trip label: "1-week trips in December" or "1-week trips in March"
TRIP_LABEL_RE = re.compile(r"(\d+-week trips? in \w+)")

# Trip params: "6–9 days · Round trip · 1 adult · Economy"
PARAMS_RE = re.compile(
    r"(\d+\s*[–—-]\s*\d+\s*days\s*·\s*"
    r"(?:Round trip|One way)\s*·\s*"
    r"\d+\s*adults?\s*·\s*"
    r"\w+)"
)

# Price range: "HK$9,800    HK$15,000" (separated by tab, en-dash, or hyphen)
# Excludes the line with "From HK$" prefix to avoid matching the "low price"
PRICE_RANGE_RE = re.compile(
    r"(?<!From\s)(?:HK\$|NT\$|US\$|\$|€|£|¥)\s*(?P<low>[\d,]+)\s*"
    r"[–\t\-—]\s*"
    r"(?:HK\$|NT\$|US\$|\$|€|£|¥)\s*(?P<high>[\d,]+)"
)

# "Prices updated October 17, 2026 at 03:58 GMT"
UPDATED_RE = re.compile(
    r"Prices updated\s+"
    r"(?P<month>\w+)\s+(?P<day>\d+),\s+(?P<year>\d{4})\s+"
    r"at\s+(?P<time>\d+:\d+)\s*(?P<tz>GMT|UTC|HKT)?"
)

# Month name → number
MONTHS = {
    "January": 1, "February": 2, "March": 3, "April": 4,
    "May": 5, "June": 6, "July": 7, "August": 8,
    "September": 9, "October": 10, "November": 11, "December": 12,
}


def parse_email(headers: dict, body: str, view_links: Optional[List[str]] = None) -> Optional[dict]:
    """
    Parse a Google Flights digest email.

    Args:
        headers: dict with at least 'subject' and 'from'
        body: plain-text body of the email
        view_links: optional list of c.gle/Google Flights URLs in order
                    (extracted from the email HTML by the caller). The
                    parser pairs them with deals in body-text order.

    Returns:
        dict with parsed structure, or None if not a Google Flights digest
    """
    view_links = view_links or []
    from_addr = headers.get("from", "") or headers.get("From", "")
    subject = headers.get("subject", "") or headers.get("Subject", "")

    # Confirm this is from Google Flights
    if not any(p.lower() in from_addr.lower() for p in SENDER_PATTERNS):
        return None

    # Parse subject for origin + destination + min price
    subj_match = SUBJECT_RE.search(subject)
    if not subj_match:
        return None

    origin = subj_match.group("origin").strip()
    dest = subj_match.group("dest").strip()
    min_price = int(subj_match.group("min_price").replace(",", ""))

    # Clean up destination name (remove trailing ", X" suffixes)
    dest = re.sub(r",\s*[A-Z][A-Za-z]+$", "", dest).strip()

    # Walk the body line-by-line to extract deals
    lines = [l.strip() for l in body.split("\n") if l.strip()]
    deals = []
    current = None

    for line in lines:
        # Date range
        dm = DATE_RE.match(line)
        if dm:
            if current:
                deals.append(current)
            current = {
                "date_range": line,
                "dep_dow": dm.group("dow1"),
                "dep_month": dm.group("mon1"),
                "dep_day": int(dm.group("day1")),
                "ret_dow": dm.group("dow2"),
                "ret_month": dm.group("mon2"),
                "ret_day": int(dm.group("day2")),
            }
            continue

        # Price
        pm = PRICE_RE.match(line)
        if pm:
            if current is not None:
                current["save_pct"] = (
                    int(pm.group("save_pct")) if pm.group("save_pct") else None
                )
                current["price"] = int(pm.group("price").replace(",", ""))
            continue

        # Airline
        am = AIRLINE_RE.match(line)
        if am:
            if current is not None:
                current["airlines"] = am.group("airlines").strip()
                # Hermes 2026-10-18: "Nonstop" → stops=0, "N stops" → N
                if am.group("nonstop"):
                    current["stops"] = 0
                else:
                    current["stops"] = int(am.group("stops"))
                duration = am.group("duration")
                current["duration"] = f"{duration}hr"
                # Hermes 2026-10-18: also save the route, in case the
                # UI wants to show it (HKG → TPE, etc.)
                current["route_from"] = am.group("route_from")
                current["route_to"] = am.group("route_to")
            continue

    if current:
        deals.append(current)

    # Pair view_links with deals in order
    for i, d in enumerate(deals):
        if i < len(view_links):
            d["view_link"] = view_links[i]
        else:
            d["view_link"] = None

    # Trip label + params
    trip_label = None
    params = None
    for line in lines[:10]:  # Trip label/params are in the intro
        tlm = TRIP_LABEL_RE.search(line)
        if tlm and trip_label is None:
            trip_label = tlm.group(1)
        pm = PARAMS_RE.search(line)
        if pm and params is None:
            params = pm.group(1)

    # Historical price range (last line that has the range)
    price_range = None
    for line in lines:
        rng_m = PRICE_RANGE_RE.search(line)
        if rng_m:
            price_range = [
                int(rng_m.group("low").replace(",", "")),
                int(rng_m.group("high").replace(",", "")),
            ]

    # Prices updated timestamp
    updated = None
    for line in lines:
        um = UPDATED_RE.search(line)
        if um:
            month_num = MONTHS.get(um.group("month"), 0)
            try:
                hour, minute = map(int, um.group("time").split(":"))
                tz_str = um.group("tz") or "GMT"
                # Convert GMT/UTC to UTC
                if tz_str in ("GMT", "UTC"):
                    tz = timezone.utc
                else:
                    # Assume HKT if no tz
                    tz = timezone(timedelta(hours=8))
                updated = datetime(
                    int(um.group("year")),
                    month_num,
                    int(um.group("day")),
                    hour,
                    minute,
                    tzinfo=tz,
                )
                break
            except (ValueError, AttributeError):
                continue

    return {
        "source": "google_flights",
        "sender": from_addr,
        "subject": subject,
        "origin": origin,
        "destination": dest,
        "min_price": min_price,
        "trip_label": trip_label,
        "params": params,
        "price_range": price_range,
        "deals": deals,
        "view_links": view_links,
        "prices_updated": updated.isoformat() if updated else None,
        "parsed_at": datetime.now(timezone.utc).isoformat(),
    }


# CLI for testing: python gflights_parser.py < email.txt
if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            content = f.read()
        # Simple .eml parsing: split headers and body
        if "\n\n" in content:
            headers_text, body = content.split("\n\n", 1)
        else:
            headers_text, body = "", content
        headers = {}
        for line in headers_text.split("\n"):
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        result = parse_email(headers, body)
        if result:
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print("Not a Google Flights digest", file=sys.stderr)
            sys.exit(1)
    else:
        print("Usage: python gflights_parser.py <email.txt>")
        sys.exit(1)
