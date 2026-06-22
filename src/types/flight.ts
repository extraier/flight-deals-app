export interface HistoryPoint {
  price: number; // price recorded N days ago
  diff: number; // current.price - history.price (positive = went up)
  pct: number; // diff / history.price * 100
}

export interface CheapDate {
  day: number;
  month: number;
  year: number;
  duration?: number; // 行程天數
  price?: number;
  // Hermes: history lets the UI flag dates where the current row price has
  // already reverted above what the calendar scanner last reported. The scanner
  // re-queries Google on a smart-skip policy, but until that next pass lands
  // (every 50min HKG / 50min SZX), this tells the UI which green cells are stale.
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
  currency: string;
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
