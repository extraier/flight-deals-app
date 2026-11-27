/**
 * Hong Kong stay-7 price calendar.
 *
 * The home feed (/api/deals) only ships the 30 cheapest dates. This module
 * builds a month grid from the full stay-7 pool (about four months). Days
 * the scanner did not collect stay empty. Shenzhen is not plotted.
 */

export const STAY_NIGHTS = 7;
export const STAY_LABEL = '7日來回';
export const CALENDAR_MONTHS = 4;

export interface HistoryPoint {
  price: number;
}

export interface CalendarFare {
  date: string;
  price: number;
  retDate?: string | null;
  lastVerified?: string | null;
  history?: Partial<Record<'1d' | '4d' | '7d', HistoryPoint | number>>;
  /** Present only when the source row has a real carrier. Placeholders are dropped. */
  airline?: string | null;
  /** Flight number, when the source row has one. Times and terminals are not stored here. */
  flight?: string | null;
}

export interface CalendarCell {
  date: string;
  day: number;
  inMonth: boolean;
  price: number | null;
  retDate: string | null;
  lastVerified: string | null;
  history: Partial<Record<'1d' | '4d' | '7d', HistoryPoint>>;
  airline?: string | null;
  flight?: string | null;
}

export interface CalendarMonth {
  key: string;
  label: string;
  weeks: CalendarCell[][];
}

export interface PriceCalendar {
  heatmap: true;
  departure: 'HKG';
  dest: string;
  name: string;
  stayNights: 7;
  stayLabel: typeof STAY_LABEL;
  typicalPrice: number;
  pricedDays: number;
  minPrice: number;
  maxPrice: number;
  months: CalendarMonth[];
}

export interface CalendarUnavailable {
  heatmap: false;
  departure: 'HKG' | 'SZX';
  dest: string;
  reason: 'szx-sparse' | 'no-pool';
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;
export { WEEKDAYS };

export function hktToday(now = new Date()): string {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const d = shifted.getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function stayNights(dep: string, ret: string | null | undefined): number | null {
  if (!ret || !/^\d{4}-\d{2}-\d{2}$/.test(dep) || !/^\d{4}-\d{2}-\d{2}$/.test(ret)) return null;
  const a = Date.parse(`${dep}T00:00:00Z`);
  const b = Date.parse(`${ret}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** Keep future stay-7 departures inside the four-month window. One price per day. */
export function selectStay7(
  fares: CalendarFare[],
  today = hktToday(),
  months = CALENDAR_MONTHS,
): CalendarFare[] {
  const end = endOfWindow(today, months);
  const byDate = new Map<string, CalendarFare>();
  for (const fare of fares) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fare.date)) continue;
    if (fare.date < today || fare.date > end) continue;
    const nights = fare.retDate ? stayNights(fare.date, fare.retDate) : STAY_NIGHTS;
    if (nights !== STAY_NIGHTS) continue;
    if (!Number.isFinite(fare.price) || fare.price <= 0) continue;
    const prev = byDate.get(fare.date);
    if (!prev || fare.price < prev.price) byDate.set(fare.date, fare);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function typicalFromFares(fares: CalendarFare[], given?: number | null): number {
  if (typeof given === 'number' && given > 0) return Math.round(given);
  if (fares.length === 0) return 0;
  const sum = fares.reduce((s, f) => s + f.price, 0);
  return Math.round(sum / fares.length);
}

export function savingsVsTypical(price: number, typicalPrice: number): number | null {
  if (!typicalPrice || typicalPrice <= 0 || price >= typicalPrice) return null;
  return Math.round(((typicalPrice - price) / typicalPrice) * 100);
}

export function historyRows(
  price: number,
  history: CalendarCell['history'],
): Array<{ key: '1d' | '4d' | '7d'; label: string; oldPrice: number; pct: number }> {
  const labels = { '1d': '1日前', '4d': '4日前', '7d': '7日前' } as const;
  const rows = [];
  for (const key of ['1d', '4d', '7d'] as const) {
    const oldPrice = history[key]?.price;
    if (oldPrice == null || oldPrice <= 0) continue;
    rows.push({
      key,
      label: labels[key],
      oldPrice,
      pct: Math.round(((price - oldPrice) / oldPrice) * 100),
    });
  }
  return rows;
}

/** A move smaller than this, versus the latest history point, is not marked. */
export const FARE_MOVE_MIN = 0.03;

export interface FareMove {
  direction: 'up' | 'down';
  delta: number;
  pct: number;
  oldPrice: number;
  key: '1d' | '4d' | '7d';
}

/**
 * Compare the fare with the latest history we actually have (1 day, else 4, else 7).
 * A shift under 3% is not a move. An older point is not used once a later one exists.
 */
export function latestFareMove(price: number, history: CalendarCell['history']): FareMove | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  for (const key of ['1d', '4d', '7d'] as const) {
    const oldPrice = history[key]?.price;
    if (oldPrice == null || oldPrice <= 0) continue;
    const raw = (price - oldPrice) / oldPrice;
    if (Math.abs(raw) < FARE_MOVE_MIN) return null;
    const roundedNow = Math.round(price);
    const roundedOld = Math.round(oldPrice);
    const delta = Math.abs(roundedNow - roundedOld);
    if (delta <= 0) return null;
    return {
      direction: raw < 0 ? 'down' : 'up',
      delta,
      pct: Math.round(raw * 100),
      oldPrice,
      key,
    };
  }
  return null;
}

/** Drop empty strings and the scanner's "any airline" placeholder. */
export function usableLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/^_/, '').trim();
  if (!text) return null;
  const key = text.toLowerCase().replace(/[\s_]+/g, '-');
  if (
    key === 'any' ||
    key === 'any-airline' ||
    key === 'null' ||
    key === 'none' ||
    key === 'n/a' ||
    text === '不限' ||
    text === '不限航空'
  ) {
    return null;
  }
  return text;
}

/** 0 = cheapest, 1 = most expensive. A single price is the cheap end. */
export function priceHeat(price: number, minPrice: number, maxPrice: number): number {
  if (maxPrice <= minPrice) return 0;
  return Math.min(1, Math.max(0, (price - minPrice) / (maxPrice - minPrice)));
}

export function buildPriceCalendar(input: {
  dest: string;
  name: string;
  fares: CalendarFare[];
  typicalPrice?: number | null;
  today?: string;
}): PriceCalendar | null {
  const today = input.today || hktToday();
  const fares = selectStay7(input.fares, today);
  if (fares.length === 0) return null;
  const prices = fares.map((f) => f.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const byDate = new Map(fares.map((f) => [f.date, f]));
  const months = monthWindows(today, CALENDAR_MONTHS).map((month) => ({
    key: month.key,
    label: month.label,
    weeks: weeksForMonth(month.year, month.month, byDate),
  }));
  return {
    heatmap: true,
    departure: 'HKG',
    dest: input.dest,
    name: input.name,
    stayNights: STAY_NIGHTS,
    stayLabel: STAY_LABEL,
    typicalPrice: typicalFromFares(fares, input.typicalPrice),
    pricedDays: fares.length,
    minPrice,
    maxPrice,
    months,
  };
}

export function googleFlightsHref(dest: string, depDate: string, retDate?: string | null): string {
  const ret = retDate && stayNights(depDate, retDate) === STAY_NIGHTS ? `+${retDate}` : '';
  return `https://www.google.com/travel/flights?q=HKG+to+${dest}+${depDate}${ret}&gl=hk&hl=zh-TW&curr=HKD`;
}

function endOfWindow(today: string, months: number): string {
  const [y, m] = today.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1 + months, 0));
  return end.toISOString().slice(0, 10);
}

function monthWindows(today: string, count: number): Array<{ key: string; label: string; year: number; month: number }> {
  const [y, m] = today.split('-').map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    const dt = new Date(Date.UTC(y, m - 1 + i, 1));
    const year = dt.getUTCFullYear();
    const month = dt.getUTCMonth() + 1;
    out.push({
      key: `${year}-${String(month).padStart(2, '0')}`,
      label: `${year}年${month}月`,
      year,
      month,
    });
  }
  return out;
}

function weeksForMonth(
  year: number,
  month: number,
  byDate: Map<string, CalendarFare>,
): CalendarCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startPad = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < startPad; i++) cells.push(blankCell());
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const fare = byDate.get(date);
    const airline = usableLabel(fare?.airline);
    const flight = usableLabel(fare?.flight);
    cells.push({
      date,
      day,
      inMonth: true,
      price: fare ? fare.price : null,
      retDate: fare?.retDate || (fare ? addDays(date, STAY_NIGHTS) : null),
      lastVerified: fare?.lastVerified || null,
      history: normalizeHistory(fare?.history),
      ...(airline ? { airline } : {}),
      ...(flight ? { flight } : {}),
    });
  }
  while (cells.length % 7 !== 0) cells.push(blankCell());
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function blankCell(): CalendarCell {
  return {
    date: '',
    day: 0,
    inMonth: false,
    price: null,
    retDate: null,
    lastVerified: null,
    history: {},
  };
}

function normalizeHistory(
  history: CalendarFare['history'],
): CalendarCell['history'] {
  const out: CalendarCell['history'] = {};
  if (!history) return out;
  for (const key of ['1d', '4d', '7d'] as const) {
    const value = history[key];
    if (typeof value === 'number' && value > 0) out[key] = { price: value };
    else if (value && typeof value === 'object' && typeof value.price === 'number' && value.price > 0) {
      out[key] = { price: value.price };
    }
  }
  return out;
}
