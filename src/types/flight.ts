// Shared flight-deal types. Used by both the page-level route handler
// (`src/app/route/[code]/page.tsx`) and the FlightDealCard component.
// Keep this in sync with `src/components/FlightDealCard.tsx`'s local
// interfaces — the source of truth is the FlightDealCard's shape
// (it has the most fields actually used in the UI).

export interface FlightInfo {
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
  /** Per-date price after the scanner's cheapest-date update step. The
   *  calendar UI always renders this, so it's required; if the loader
   *  can't determine a price, it should drop the date rather than emit
   *  an undefined price that would crash `toLocaleString()`. */
  price: number;
  flight?: FlightInfo;
  /**
   * History lets the UI flag dates where the current row price has
   * already reverted above what the calendar scanner last reported.
   * The scanner re-queries Google on a smart-skip policy; until that
   * next pass lands (every 50min HKG / 50min SZX), this tells the UI
   * which green cells are stale.
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
}
