// Shared flight-deal types. Used by both the page-level route handler
// (`src/app/route/[code]/page.tsx`) and the FlightDealCard component.
//
// Source of truth: `export_all_dates_hkg_v2.py` and `export_all_dates_szx.py`
// on the NAS — they write `src/data/all_dates*.json` which this layer
// consumes.
//
// Hermes 2026-08-23: the JSON shape now separates calendar (dateComparison,
// historyComparison) from detail (cheapestDates[].itinerary). Per the
// Detail-Flight Scan Enforcement Incident Review's R7 — "calendar and
// detail outputs semantically separate" — the carrier/flight/time data
// is now scoped under `itinerary` and carries an explicit status, so the
// UI can render "details unavailable" instead of a stale flight number.

// ── Deal-confidence (Manus, 2026-08-23) ─────────────────────────────────

export type ComparisonStatus = "ready" | "insufficient_data" | "not_collected";

export interface ComparisonSummary {
  scope: string;
  status: ComparisonStatus;
  /**
   * Number of peer records that participated in the comparison.
   * Always reflects the actual peer count, even when status is
   * insufficient_data — the UI uses this to render "資料不足（X 筆）".
   */
  sampleSize: number;
  /** % of peer records strictly CHEAPER than the candidate (0-100). */
  pricePercentile?: number;
  /** (candidate - median) / median * 100. Negative = candidate is cheaper. */
  vsMedian?: number;
  /** Median of peer prices. */
  median?: number;
  /**
   * When status === "not_collected", this is the human-readable reason.
   * Always present for not_collected; absent for ready / insufficient_data.
   */
  reason?: string;
}

export interface DateComparison extends ComparisonSummary {
  scope: "same_stay_length";
  stay?: number;
}

export interface HistoryComparison extends ComparisonSummary {
  scope: "all_observations";
}

export interface MarketComparison extends ComparisonSummary {
  scope: "carrier_overlay";
  /**
   * Until a current authorized detail source (post-recovery) confirms
   * the market, this is always "not_collected" with
   * reason="requires_all_comparable_itineraries".
   */
  status: "not_collected";
  reason: "requires_all_comparable_itineraries";
}

// ── Itinerary (formerly the loose "flight" object) ──────────────────────

export type ItineraryStatus =
  /** Detail scan produced a fresh result within DETAIL_MAX_AGE_HOURS. */
  | "selected"
  /** Detail scanner couldn't reach the provider (ban / circuit open / disabled). */
  | "not_collected"
  /** Detail scan produced a result but it's older than DETAIL_MAX_AGE_HOURS. */
  | "stale";

export type ItinerarySource =
  | "flight_details"
  | "flight_dates_fallback"
  | null;

export interface ItineraryLeg {
  airline: string;
  flight: string;
  depTime: string;
  arrTime: string;
}

export interface Itinerary {
  /**
   * What does this row actually represent? Honest answer, not marketing.
   *   selected       — verified from a fresh detail scan
   *   not_collected  — detail scanner disabled or blocked; we have no data
   *   stale          — detail scan worked but is older than the staleness threshold
   */
  status: ItineraryStatus;
  /** Which SQLite table the row came from. null when status is not_collected. */
  source: ItinerarySource;
  /** ISO 8601 timestamp of the underlying scan_time. null when not_collected. */
  scannedAt: string | null;
  outbound?: ItineraryLeg;
  return?: ItineraryLeg;
  retDate?: string;
}

// ── Existing types (kept stable) ───────────────────────────────────────

export interface FlightInfo {
  /**
   * @deprecated Use Itinerary instead. This is the legacy shape that mixed
   * calendar and detail data without a status field. New code should read
   * `cheapestDates[].itinerary` instead.
   */
  airline: string;
  flight_no: string;
  dep_time: string;
  arr_time?: string;
  return_airline?: string;
  return_dep_time?: string;
  return_arr_time?: string;
  return_flight?: string;
  ret_date?: string;
}

export interface HistoryPoint {
  price: number; // price recorded N days ago
  diff: number;  // current.price - history.price (positive = went up)
  pct: number;   // diff / history.price * 100
}

export interface CheapDate {
  day: number;
  month: number;
  year: number;
  /** 行程天數 (length of stay). Used by the UI to label the date button. */
  stay?: number | null;
  /**
   * Per-date price after the scanner's cheapest-date update step. The
   * calendar UI always renders this, so it's required; if the loader
   * can't determine a price, it should drop the date rather than emit
   * an undefined price that would crash `toLocaleString()`.
   *
   * Always present — comes from `flight_dates` (calendar), never from
   * `flight_details`. See `itinerary.price` if you need a verified
   * detail-scan price.
   */
  price: number;
  /** @deprecated Use `itinerary` instead. */
  flight?: FlightInfo;
  /**
   * New shape (Hermes 2026-08-23). Always present in fresh exports;
   * `status` tells the UI what to render.
   */
  itinerary?: Itinerary;
  /**
   * History lets the UI flag dates where the current row price has
   * already reverted above what the calendar scanner last reported.
   */
  history?: Record<string, HistoryPoint>;
}

export interface FlightDeal {
  route: string;
  destination: {
    name: string;
    code: string;
    region: string;
  };
  /**
   * Top-level price. Comes from the cheapest calendar date (flight_dates);
   * NOT verified by a detail scan. The UI should label this as "calendar
   * price" or render the cheaper of price + itinerary.price.
   */
  price: number;
  currency?: string;
  badge?: {
    carryOn?: boolean;
    duration?: number;
    cheapDays?: number;
  };
  typicalPrice?: number;
  cheapestDates: CheapDate[];
  moreMonths?: number;
  totalDestinations?: number;

  // ── Deal-confidence (Hermes 2026-08-23) ─────────────────────────────

  /**
   * Comparison against same-stay-length peers in this calendar pool.
   * sampleSize >= 3 → ready; otherwise insufficient_data.
   */
  dateComparison?: DateComparison;
  /**
   * Comparison against all observations in historical_prices.
   * sampleSize >= 2 → ready; otherwise insufficient_data.
   */
  historyComparison?: HistoryComparison;
  /**
   * Comparison against the full carrier-overlay (every carrier's cheapest
   * for the same dep_date/ret_date pair). Always not_collected while the
   * detail scanner is disabled — see R7 in the Incident Review.
   */
  marketComparison?: MarketComparison;
}
