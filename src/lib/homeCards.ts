/**
 * Home destination-card labels.
 *
 * The red percentage has two real baselines, chosen by the comparison chip:
 *   今日     — typicalPrice, the average of the scanned dates on that route
 *   1/4/7日前 — that lead date's history price (history.1d / 4d / 7d)
 * The label names whichever baseline the chip selected. A missing history
 * price is left blank rather than relabeled as 平時.
 */

export type HomeCompareWindow = 'now' | '1d' | '4d' | '7d';

export interface LeadFareDate {
  day: number;
  month: number;
  year: number;
  stay?: number | null;
}

const WINDOW_LABEL: Record<Exclude<HomeCompareWindow, 'now'>, string> = {
  '1d': '1日',
  '4d': '4日',
  '7d': '7日',
};

/**
 * Chinese airline name for the lead fare. Uses the same name map as the
 * home-page filter. A code with no Chinese name is shown as that code,
 * which is what the deals page already does. Nothing is shown when the
 * fare has no airline.
 */
export function leadAirlineLabel(
  date: { flight?: unknown; itinerary?: unknown; airline?: unknown } | undefined,
  names: Record<string, string>,
): string | null {
  const code = airlineCode(date);
  if (!code) return null;
  return names[code] || names[code.toUpperCase()] || code;
}

function airlineCode(
  date: { flight?: unknown; itinerary?: unknown; airline?: unknown } | undefined,
): string {
  if (!date) return '';
  const direct = cleanCode(date.airline);
  if (direct) return direct;
  const flight = asRecord(date.flight);
  const fromFlight = cleanCode(flight?.airline);
  if (fromFlight) return fromFlight;
  const itinerary = asRecord(date.itinerary);
  const outbound = asRecord(itinerary?.outbound);
  return cleanCode(outbound?.airline);
}

function cleanCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/^_/, '').trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function leadFareDateLabel(date: LeadFareDate | undefined): string {
  if (!date || !date.year || !date.month || !date.day) return '';
  const start = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (Number.isNaN(start.getTime())) return '';
  const stay = typeof date.stay === 'number' && date.stay > 0 ? Math.round(date.stay) : 0;
  if (!stay) return formatUtc(start);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + stay);
  return formatUtcRange(start, end);
}

export function homeSavingsText(
  price: number,
  typicalPrice: number,
  window: HomeCompareWindow,
  historyPrice: number | null | undefined,
): string | null {
  if (window === 'now') {
    if (!typicalPrice || typicalPrice <= 0) return null;
    const pct = Math.round(((typicalPrice - price) / typicalPrice) * 100);
    if (pct <= 0) return null;
    return `較平時低 ${pct}%`;
  }
  if (historyPrice == null || historyPrice <= 0) return null;
  const pct = Math.round(((price - historyPrice) / historyPrice) * 100);
  if (pct >= 0) return null;
  return `較${WINDOW_LABEL[window]}低 ${Math.abs(pct)}%`;
}

function formatUtc(date: Date): string {
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

function formatUtcRange(start: Date, end: Date): string {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + 1;
  const d = start.getUTCDate();
  const ey = end.getUTCFullYear();
  const em = end.getUTCMonth() + 1;
  const ed = end.getUTCDate();
  if (y === ey && m === em) return `${y}年${m}月${d}日–${ed}日`;
  if (y === ey) return `${y}年${m}月${d}日–${em}月${ed}日`;
  return `${y}年${m}月${d}日–${ey}年${em}月${ed}日`;
}
