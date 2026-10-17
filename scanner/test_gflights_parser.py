"""
Test the gflights parser against sample emails.

Tests use the browser-extracted body text from real Google Flights
digest emails. Run with: python test_gflights_parser.py
"""

import sys
import os
import json

sys.path.insert(0, os.path.dirname(__file__))
from gflights_parser import parse_email


FORT_LAUDERDALE = {
    "headers": {
        "from": "Google Flights <noreply-travel@google.com>",
        "subject": "Your tracked route: Hong Kong to Fort Lauderdale, Miami flights from HK$9,082",
    },
    "body": """Hello,

We've found some great prices for 1-week trips in December, from Hong Kong to Fort Lauderdale, Miami.

1-week trips in December
6–9 days · Round trip · 1 adult · Economy

Thu, Dec 24 – Thu, Dec 31
SAVE 18%From HK$9,082


View


China Airlines, Delta · 2 stops · HKG–MIA · 24 hr



Mon, Dec 14 – Wed, Dec 23
SAVE 12%From HK$9,818


View


American, Cathay Pacific · 1 stop · HKG–MIA · 21 hr



Thu, Dec 17 – Wed, Dec 23
SAVE 12%From HK$9,818


View


American, Cathay Pacific · 1 stop · HKG–MIA · 21 hr

Prices are currently low for December
HK$9,082 is low

HK$9,800	HK$15,000
Prices are cheaper than usual. The least expensive flights for similar trips to Fort Lauderdale, Miami usually cost between HK$9,800–15,000. Anything less is considered a deal.
View more flights

Did you find this email useful?

All savings and insights are based on fares observed in the last 12 months for trips in the same season, of similar length, with the same origin and destination, number of stops, class and airline.
Prices updated October 17, 2026 at 03:58 GMT
You received this email because you signed up to receive travel tips and price updates from Google Flights.
Manage price tracking
Unsubscribe

Google LLC
1600 Amphitheatre Parkway,
Mountain View, CA 94043
""",
}

LAS_VEGAS = {
    "headers": {
        "from": "Google Flights <noreply-travel@google.com>",
        "subject": "Your tracked route: Hong Kong to Las Vegas flights from HK$7,138",
    },
    "body": """Hello,

We've found the best prices available for 1-week trips in January, from Hong Kong to Las Vegas.

1-week trips in January
6–9 days · Round trip · 1 adult · Economy

Mon, Jan 4 – Sun, Jan 10
From HK$30,344


View


China Eastern · 1 stop · HKG–LAX · 14 hr

Thu, Jan 28 – Thu, Feb 4
From HK$7,138


View


Alaska, Cathay Pacific · 2 stops · HKG–LAS · 21 hr



Thu, Jan 21 – Wed, Jan 27
From HK$7,348


View


Delta · 1 stop · HKG–LAS · 18 hr



Thu, Jan 14 – Wed, Jan 20
From HK$7,348


View


Delta · 1 stop · HKG–LAS · 25 hr

Prices are currently low for January
HK$7,138 is low

HK$5,800	HK$16,500
Prices are cheaper than usual. The least expensive flights for similar trips to Las Vegas usually cost between HK$5,800–16,500. Anything less is considered a deal.
View more flights

Did you find this email useful?

All savings and insights are based on fares observed in the last 12 months for trips in the same season, of similar length, with the same origin and destination, number of stops, class and airline.
Prices updated October 17, 2026 at 11:44 GMT
You received this email because you signed up to receive travel tips and price updates from Google Flights.
Manage price tracking
Unsubscribe

Google LLC
1600 Amphitheatre Parkway,
Mountain View, CA 94043
""",
}


def test_fort_lauderdale():
    """3 deals, all with SAVE %, cross-month not present."""
    result = parse_email(FORT_LAUDERDALE["headers"], FORT_LAUDERDALE["body"])
    assert result is not None, "Should parse Fort Lauderdale"
    assert result["origin"] == "Hong Kong"
    assert result["destination"] == "Fort Lauderdale"
    assert result["min_price"] == 9082
    assert result["trip_label"] == "1-week trips in December"
    assert result["params"] == "6–9 days · Round trip · 1 adult · Economy"
    assert result["price_range"] == [9800, 15000]
    assert len(result["deals"]) == 3, f"Expected 3 deals, got {len(result['deals'])}"
    # First deal: SAVE 18%, $9,082, 2 stops, China Airlines
    d0 = result["deals"][0]
    assert d0["save_pct"] == 18
    assert d0["price"] == 9082
    assert d0["stops"] == 2
    assert d0["airlines"] == "China Airlines, Delta"
    assert d0["duration"] == "24hr"
    assert d0["date_range"] == "Thu, Dec 24 – Thu, Dec 31"
    print("✓ Fort Lauderdale: 3 deals, all SAVE % present, prices correct")


def test_las_vegas():
    """4 deals, no SAVE %, cross-month (Jan 28 - Feb 4)."""
    result = parse_email(LAS_VEGAS["headers"], LAS_VEGAS["body"])
    assert result is not None, "Should parse Las Vegas"
    assert result["origin"] == "Hong Kong"
    assert result["destination"] == "Las Vegas"
    assert result["min_price"] == 7138
    assert result["trip_label"] == "1-week trips in January"
    assert result["price_range"] == [5800, 16500]
    assert len(result["deals"]) == 4, f"Expected 4 deals, got {len(result['deals'])}"
    # No SAVE % in this email
    for d in result["deals"]:
        assert d["save_pct"] is None, f"Las Vegas shouldn't have SAVE %, got {d['save_pct']}"
    # Cross-month: Jan 28 - Feb 4
    cross = result["deals"][1]
    assert cross["date_range"] == "Thu, Jan 28 – Thu, Feb 4"
    assert cross["dep_month"] == "Jan"
    assert cross["ret_month"] == "Feb"
    print("✓ Las Vegas: 4 deals, no SAVE %, cross-month detected")


def test_non_google_flights():
    """Non-Google-Flights emails return None."""
    headers = {"from": "foo@bar.com", "subject": "Hello world"}
    body = "This is not a Google Flights email"
    result = parse_email(headers, body)
    assert result is None, f"Should return None for non-GF email, got {result}"
    print("✓ Non-Google-Flights email returns None")


def test_wrong_subject():
    """Email from noreply-travel but wrong subject returns None."""
    headers = {"from": "Google Flights <noreply-travel@google.com>",
               "subject": "Welcome to Google Flights"}
    body = "Welcome! Some other text."
    result = parse_email(headers, body)
    assert result is None, f"Should return None for non-digest email"
    print("✓ Wrong subject returns None")


if __name__ == "__main__":
    test_fort_lauderdale()
    test_las_vegas()
    test_non_google_flights()
    test_wrong_subject()
    print("\nAll tests passed!")
