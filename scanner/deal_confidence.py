"""Deal confidence payload for the flight-deals export.

This module computes three comparison stages for a candidate cheap-date
entry, using only data the calendar scanner already writes. No new HTTP
queries to Google Flights are made here, so the rollout is safe even
when the detail scanners are offline (see
flight-deals-fleet-status-2026-08-23 for the current ban diagnosis).

Manus 2026-08-22 spec (Comparable-Itinerary Deal Confidence Rollout.md):

  - dateComparison: same route + same trip length (stay) across the
    exporter's available date pairs.
  - historyComparison: same complete departure/return date pair at
    available historical checkpoints.
  - marketComparison: same-day airline market. Explicitly withheld until
    the detail scanner captures every comparable offer per query into
    `itinerary_offers`. Must not be an alert prerequisite today.

The alert rule from the spec requires a sample-size threshold of at
least three same-stay peer observations before `dateComparison` can be
treated as `ready`. We mirror that threshold here.
"""

from __future__ import annotations

from statistics import median
from typing import Iterable, Optional, Union

PriceLike = Union[int, float, str, None]

# Minimum same-stay peer count before dateComparison can be `ready`.
# Mirrors the spec's "at least three same-stay peer dates" validation step
# and the alert rule's "sample size meets the configured minimum".
MIN_DATE_PEERS = 3

# Minimum history observations before historyComparison can be `ready`.
# Two is not enough to distinguish a real drop from noise.
MIN_HISTORY_OBSERVATIONS = 2

# marketComparison: the stage we are NOT yet collecting. The reason
# string is the same one Manus used in the rollout doc — renderers can
# grep for it to decide whether to surface a "data limitation" callout.
MARKET_NOT_COLLECTED_REASON = "requires_all_comparable_itineraries"


def _normalize_price(value) -> float | None:
    """Return a positive float price, or None if missing/invalid."""
    try:
        p = float(value)
    except (TypeError, ValueError):
        return None
    if p <= 0 or p != p:  # NaN guard
        return None
    return p


def _stay_length_nights(entry: dict, dep_date: str | None, ret_date: str | None) -> int | None:
    """Compute stay length in nights from the entry's dates.

    The entry typically carries `stay` already (set by the calendar
    scanner). When the field is missing we fall back to computing it
    from `dep_date` and `ret_date`. Returns None when neither is
    available — the comparator filters out such candidates.
    """
    explicit = entry.get("stay")
    if explicit is not None:
        try:
            s = int(explicit)
            if s > 0:
                return s
        except (TypeError, ValueError):
            pass

    if dep_date and ret_date:
        try:
            from datetime import datetime
            d = datetime.strptime(dep_date, "%Y-%m-%d")
            r = datetime.strptime(ret_date, "%Y-%m-%d")
            diff = (r - d).days
            if diff > 0:
                return diff
        except (TypeError, ValueError):
            pass

    return None


def _filter_same_stay(route_date_context: Iterable[dict], stay: int | None) -> list[dict]:
    """Return only context peers that share the candidate's stay length.

    The spec is explicit: a 4-night option must be compared only against
    other 4-night options, never against a 7-night or a truncated list
    of cheapest dates. Peers missing a usable stay or price are dropped
    silently — they were never valid comparator inputs.
    """
    if stay is None:
        return []

    peers = []
    for peer in route_date_context:
        peer_price = _normalize_price(peer.get("price"))
        peer_stay = peer.get("stay")
        if peer_price is None or peer_stay is None:
            continue
        try:
            if int(peer_stay) != stay:
                continue
        except (TypeError, ValueError):
            continue
        peers.append(peer)
    return peers


def _summary_from_peers(peers: list[dict], candidate_price: float | None) -> dict:
    """Build the ComparisonSummary shape used in both date and history stages.

    For `dateComparison` we pass peer dicts with a `price` field.
    For `historyComparison` we wrap a flat price list in dicts before
    calling this helper so the two paths share one calculation.

    The result is shaped to match the TypeScript `ComparisonSummary`:
      status: 'ready' | 'insufficient_data'
      sampleSize: total peers observed
      lowestPrice / medianPrice / pricePercentile / vsMedianPct: only
        populated when status is 'ready'.

    `sampleSize` always reflects the actual peer count, even when the
    candidate price is invalid. UI uses this to show "資料不足（X 筆）"
    even when the candidate itself is malformed — the user still gets
    feedback on how many peers the system saw.
    """
    prices = [_normalize_price(p.get("price")) for p in peers]
    prices = [p for p in prices if p is not None]
    sample_size = len(prices)

    base = {"status": "insufficient_data", "sampleSize": sample_size}

    if sample_size < 1 or candidate_price is None:
        return base

    lowest = min(prices)
    med = median(prices)

    # pricePercentile: share of peer prices strictly cheaper than the
    # candidate. A value of 0.0 means no retained peer is cheaper; it
    # does NOT claim the offer is the cheapest globally. Per spec.
    cheaper_count = sum(1 for p in prices if p < candidate_price)
    percentile = (cheaper_count / len(prices)) * 100.0

    # vsMedianPct: current offer vs the peer median, negative is better.
    if med > 0:
        vs_median = ((candidate_price - med) / med) * 100.0
    else:
        vs_median = 0.0

    return {
        "status": "ready",
        "sampleSize": sample_size,
        "lowestPrice": round(lowest, 2),
        "medianPrice": round(med, 2),
        "pricePercentile": round(percentile, 2),
        "vsMedianPct": round(vs_median, 2),
    }


def build_date_comparison(
    entry: dict,
    route_date_context: Iterable[dict],
    min_peers: int = MIN_DATE_PEERS,
) -> dict:
    """Compute `dateComparison` for one cheap-date entry.

    Args:
      entry: the candidate cheap-date dict (must carry `price` and
        either `stay` or both `dep_date` and `ret_date`).
      route_date_context: every same-route date pair the exporter knows
        about, with at least `price` and `stay` fields. We filter by
        candidate's stay length here.
      min_peers: minimum same-stay peer count before status flips to
        `ready`. Defaults to 3 per the spec.

    Returns:
      The shape consumed by `src/types/flight.ts#DealComparison.dateComparison`.
    """
    dep_date = entry.get("dep_date")
    ret_date = entry.get("ret_date")
    stay = _stay_length_nights(entry, dep_date, ret_date)

    candidate_price = _normalize_price(entry.get("price"))

    base = {
        "scope": "same_stay_length",
        "stay": stay,
        "status": "insufficient_data",
        "sampleSize": 0,
    }

    # Even when we can't compute a percentile (no stay, invalid price),
    # we still want the UI to show how many peers were observed. Filter
    # here so the sampleSize reflects actual peer count.
    peers = _filter_same_stay(route_date_context, stay) if stay is not None else []
    sample_size = len(peers)

    if stay is None or candidate_price is None or sample_size < min_peers:
        return {**base, "sampleSize": sample_size}

    summary = _summary_from_peers(peers, candidate_price)
    return {"scope": "same_stay_length", "stay": stay, **summary}


def build_history_comparison(
    entry: dict,
    pair_history: Iterable[PriceLike],
    min_observations: int = MIN_HISTORY_OBSERVATIONS,
) -> dict:
    """Compute `historyComparison` for one cheap-date entry.

    Args:
      entry: the candidate cheap-date dict (must carry `price`; the
        dep+ret pair is implicitly the one the caller passed history for).
      pair_history: a flat list of past total round-trip prices observed
        for the same (route, dep_date, ret_date) tuple, typically from
        `historical_prices` rows where recorded_date != today.
      min_observations: minimum historical observations before status
        flips to `ready`.

    Returns:
      The shape consumed by `src/types/flight.ts#DealComparison.historyComparison`.
    """
    candidate_price = _normalize_price(entry.get("price"))

    base = {
        "scope": "same_date_pair_observations",
        "status": "insufficient_data",
        "sampleSize": 0,
    }

    prices = []
    for p in pair_history:
        normalized = _normalize_price(p)
        if normalized is not None:
            prices.append({"price": normalized})

    sample_size = len(prices)

    if sample_size < min_observations or candidate_price is None:
        return {**base, "sampleSize": sample_size}

    summary = _summary_from_peers(prices, candidate_price)
    return {"scope": "same_date_pair_observations", **summary}


def build_market_comparison() -> dict:
    """Always return the explicit `not_collected` shape.

    The spec is unambiguous: do not remove this `not_collected` status
    until the detailed scanner writes every comparable offer received for
    a query into a separate table (e.g. `itinerary_offers`). Until then
    this function is the single source of truth for that shape.
    """
    return {
        "status": "not_collected",
        "reason": MARKET_NOT_COLLECTED_REASON,
    }


def build_deal_confidence(
    entry: dict,
    route_date_context: Iterable[dict],
    pair_history: Iterable[PriceLike],
) -> dict:
    """Compute the full `comparison` block for one cheap-date entry.

    Args:
      entry: the candidate cheap-date dict.
      route_date_context: full same-route date context, including the
        candidate itself. The candidate is filtered out by `stay` and
        price-strict-cheaper comparison, so leaving it in is safe.
      pair_history: flat list of past prices for the same date pair.

    Returns:
      The shape consumed by `DealComparison` in `src/types/flight.ts`:
      { dateComparison, historyComparison, marketComparison }.
    """
    return {
        "dateComparison": build_date_comparison(entry, route_date_context),
        "historyComparison": build_history_comparison(entry, pair_history),
        "marketComparison": build_market_comparison(),
    }
