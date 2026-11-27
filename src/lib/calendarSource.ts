/**
 * Full Hong Kong stay-7 date pool for /api/calendar.
 *
 * /api/deals keeps the public 30-date slice. This reader never uses that
 * file. On the NAS it expects one of:
 *   1. fli_calendar.db next to the other scanner files (FLI_DATA_DIR, or
 *      /volume1/flight-scanner). Tables flight_dates and, when present,
 *      historical_prices. departure HKG, stay 7, dep_date >= today.
 *   2. hkg_stay7_calendar.json — every stay-7 day, not the cheapest 30.
 *
 * Shenzhen is refused. Its date pool is too thin for a heatmap.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixCityName } from './cityNames';
import {
  buildPriceCalendar,
  hktToday,
  type CalendarFare,
  type CalendarUnavailable,
  type PriceCalendar,
} from './priceCalendar';

export type CalendarResponse = PriceCalendar | CalendarUnavailable;

const DB_NAMES = ['fli_calendar.db'];
const JSON_NAMES = ['hkg_stay7_calendar.json'];

export function dataDirs(): string[] {
  const dirs = [
    process.env.FLI_DATA_DIR,
    '/volume1/flight-scanner',
    '/data',
  ].filter((dir): dir is string => !!dir);
  return [...new Set(dirs)];
}

export async function loadHkgStayCalendar(
  dest: string,
  today = hktToday(),
): Promise<CalendarResponse> {
  const code = dest.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    return { heatmap: false, departure: 'HKG', dest: code, reason: 'no-pool' };
  }
  for (const dir of dataDirs()) {
    const fromDb = await readSqlite(dir, code, today);
    if (fromDb) return fromDb;
    const fromJson = await readJson(dir, code, today);
    if (fromJson) return fromJson;
  }
  return { heatmap: false, departure: 'HKG', dest: code, reason: 'no-pool' };
}

export function szxCalendar(dest: string): CalendarUnavailable {
  return { heatmap: false, departure: 'SZX', dest: dest.trim().toUpperCase(), reason: 'szx-sparse' };
}

async function readSqlite(dir: string, dest: string, today: string): Promise<PriceCalendar | null> {
  for (const name of DB_NAMES) {
    const fp = path.join(dir, name);
    try {
      await fs.access(fp);
    } catch {
      continue;
    }
    try {
      const db = new DatabaseSync(fp, { readOnly: true });
      try {
        const fares = queryStay7(db, dest, today);
        if (fares.length === 0) return null;
        const name = cityName(dest);
        return buildPriceCalendar({ dest, name, fares, today });
      } finally {
        db.close();
      }
    } catch {
      return null;
    }
  }
  return null;
}

function queryStay7(db: DatabaseSync, dest: string, today: string): CalendarFare[] {
  const route = `HKG→${dest}`;
  const tables = new Set(tableNames(db));
  if (!tables.has('flight_dates')) return [];
  const cols = new Set(columnNames(db, 'flight_dates'));
  const depFilter = cols.has('departure') ? "AND departure = 'HKG'" : '';
  const scanCol = cols.has('scan_time') ? 'scan_time' : 'NULL';
  const rows = db.prepare(`
    SELECT dep_date, ret_date, price, ${scanCol} AS scan_time
    FROM flight_dates
    WHERE route = ? ${depFilter}
      AND dep_date >= ?
  `).all(route, today) as Array<{ dep_date: string; ret_date: string | null; price: number; scan_time: string | null }>;

  const history = tables.has('historical_prices')
    ? historyFor(db, route, today)
    : new Map<string, CalendarFare['history']>();

  return rows.map((row) => ({
    date: row.dep_date,
    retDate: row.ret_date,
    price: row.price,
    lastVerified: row.scan_time,
    history: history.get(row.dep_date),
  }));
}

function historyFor(db: DatabaseSync, route: string, today: string): Map<string, CalendarFare['history']> {
  const cols = new Set(columnNames(db, 'historical_prices'));
  const depFilter = cols.has('departure') ? "AND departure = 'HKG'" : '';
  const targets = [
    ['1d', shiftIso(today, -1)],
    ['4d', shiftIso(today, -4)],
    ['7d', shiftIso(today, -7)],
  ] as const;
  const map = new Map<string, CalendarFare['history']>();
  const stmt = db.prepare(`
    SELECT dep_date, price FROM historical_prices
    WHERE route = ? AND recorded_date = ? ${depFilter}
  `);
  for (const [label, recorded] of targets) {
    const rows = stmt.all(route, recorded) as Array<{ dep_date: string; price: number }>;
    for (const row of rows) {
      const prev = map.get(row.dep_date) || {};
      prev[label] = { price: row.price };
      map.set(row.dep_date, prev);
    }
  }
  return map;
}

async function readJson(dir: string, dest: string, today: string): Promise<PriceCalendar | null> {
  for (const name of JSON_NAMES) {
    const fp = path.join(dir, name);
    try {
      const raw = await fs.readFile(fp, 'utf-8');
      const body = JSON.parse(raw) as CalendarFile;
      const route = findRoute(body, dest);
      if (!route) return null;
      const fares: CalendarFare[] = (route.dates || []).map((row) => ({
        date: row.date || row.dep_date || '',
        price: Number(row.price),
        retDate: row.retDate || row.ret_date || null,
        lastVerified: row.lastVerified || row.last_verified || null,
        history: row.history,
      }));
      const name = fixCityName(route.name || cityName(dest));
      return buildPriceCalendar({
        dest,
        name,
        fares,
        typicalPrice: route.typicalPrice,
        today,
      });
    } catch {
      continue;
    }
  }
  return null;
}

interface CalendarFile {
  routes?: CalendarRoute[] | Record<string, CalendarRoute>;
  results?: Array<{
    destination?: { code?: string; name?: string };
    typicalPrice?: number;
    cheapestDates?: Array<Record<string, unknown>>;
  }>;
}

interface CalendarRoute {
  code?: string;
  name?: string;
  typicalPrice?: number;
  dates?: Array<Record<string, unknown> & {
    date?: string;
    dep_date?: string;
    price?: number;
    retDate?: string;
    ret_date?: string;
    lastVerified?: string;
    last_verified?: string;
    history?: CalendarFare['history'];
  }>;
}

function findRoute(body: CalendarFile, dest: string): CalendarRoute | null {
  if (Array.isArray(body.routes)) {
    return body.routes.find((route) => (route.code || '').toUpperCase() === dest) || null;
  }
  if (body.routes && typeof body.routes === 'object') {
    const route = body.routes[dest] || body.routes[dest.toLowerCase()];
    if (route) return { ...route, code: dest };
  }
  const result = body.results?.find((row) => row.destination?.code?.toUpperCase() === dest);
  if (!result) return null;
  return {
    code: dest,
    name: result.destination?.name,
    typicalPrice: result.typicalPrice,
    dates: (result.cheapestDates || []).map((row) => ({
      date: row.date as string || (
        row.year && row.month && row.day
          ? `${row.year}-${String(row.month).padStart(2, '0')}-${String(row.day).padStart(2, '0')}`
          : ''
      ),
      price: row.price as number,
      history: row.history as CalendarFare['history'],
      lastVerified: (row.lastVerified || row.last_verified) as string | undefined,
    })),
  };
}

function tableNames(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function columnNames(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function cityName(code: string): string {
  return fixCityName(code);
}
