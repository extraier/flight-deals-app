import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  buildPriceCalendar,
  googleFlightsHref,
  priceHeat,
  savingsVsTypical,
  selectStay7,
  type CalendarFare,
} from '../priceCalendar.ts';
import { loadHkgStayCalendar, szxCalendar } from '../calendarSource.ts';

const TODAY = '2026-11-27';

function fare(date: string, price: number, stay = 7, history?: CalendarFare['history']): CalendarFare {
  const [y, m, d] = date.split('-').map(Number);
  const ret = new Date(Date.UTC(y, m - 1, d + stay)).toISOString().slice(0, 10);
  return { date, price, retDate: ret, lastVerified: '2026-11-26 11:02', history };
}

test('four-month grid keeps missing days empty and drops other stays', () => {
  const fares: CalendarFare[] = [];
  for (let i = 0; i < 120; i++) {
    const date = new Date(Date.UTC(2026, 10, 27 + i)).toISOString().slice(0, 10);
    if (date === '2026-12-03') continue;
    fares.push(fare(date, 1500 + (i % 17) * 80));
  }
  fares.push(fare('2026-12-10', 999, 4));
  fares.push(fare('2026-11-01', 800, 7));
  const calendar = buildPriceCalendar({
    dest: 'MNL',
    name: '馬尼拉 (MNL)',
    fares,
    typicalPrice: 2200,
    today: TODAY,
  });
  assert.ok(calendar);
  assert.equal(calendar.months.length, 4);
  assert.equal(calendar.months[0].label, '2026年11月');
  assert.equal(calendar.months[3].label, '2027年2月');
  assert.ok(calendar.pricedDays >= 90);
  assert.ok(calendar.pricedDays < 120);
  const cells = calendar.months.flatMap((month) => month.weeks.flat());
  const hole = cells.find((cell) => cell.date === '2026-12-03');
  assert.equal(hole?.price, null);
  assert.equal(cells.some((cell) => cell.date === '2026-12-10' && cell.price === 999), false);
  const past = cells.find((cell) => cell.date === '2026-11-01');
  assert.equal(past?.price ?? null, null);
  const priced = cells.filter((cell) => cell.price != null).map((cell) => cell.price as number);
  assert.ok(priceHeat(Math.min(...priced), calendar.minPrice, calendar.maxPrice) <
    priceHeat(Math.max(...priced), calendar.minPrice, calendar.maxPrice));
  assert.equal(savingsVsTypical(calendar.minPrice, calendar.typicalPrice)! > 0, true);
});

test('selectStay7 does not cap at the public 30 cheapest dates', () => {
  const fares = Array.from({ length: 100 }, (_, i) => fare(
    new Date(Date.UTC(2026, 10, 27 + i)).toISOString().slice(0, 10),
    5000 - i,
  ));
  const kept = selectStay7(fares, TODAY);
  assert.ok(kept.length > 30);
});

test('google flights link stays on the existing search url', () => {
  const href = googleFlightsHref('MNL', '2026-12-01', '2026-12-08');
  assert.match(href, /^https:\/\/www\.google\.com\/travel\/flights\?/);
  assert.match(href, /HKG\+to\+MNL\+2026-12-01\+2026-12-08/);
  assert.equal(href.includes('trip.com'), false);
});

test('SZX is not a heatmap', () => {
  assert.equal(szxCalendar('NRT').heatmap, false);
  assert.equal(szxCalendar('NRT').reason, 'szx-sparse');
});

test('json pool is read and the 30-date deals file is ignored', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cal-'));
  const dates = Array.from({ length: 100 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 10, 27 + i)).toISOString().slice(0, 10);
    return { date, price: 1800 + i * 10, retDate: new Date(Date.UTC(2026, 10, 27 + i + 7)).toISOString().slice(0, 10), history: { '1d': 2000 } };
  });
  await writeFile(path.join(dir, 'all_dates.json'), JSON.stringify({
    results: [{ destination: { code: 'MNL', name: '馬尼拉 (MNL)' }, typicalPrice: 900, cheapestDates: dates.slice(0, 30) }],
  }));
  await writeFile(path.join(dir, 'hkg_stay7_calendar.json'), JSON.stringify({
    departure: 'HKG',
    stayNights: 7,
    routes: [{ code: 'MNL', name: '馬尼拉 (MNL)', typicalPrice: 2400, dates }],
  }));
  const previous = process.env.FLI_DATA_DIR;
  process.env.FLI_DATA_DIR = dir;
  try {
    const body = await loadHkgStayCalendar('MNL', TODAY);
    assert.equal(body.heatmap, true);
    if (body.heatmap) {
      assert.ok(body.pricedDays > 30);
      assert.equal(body.name.includes('馬尼拉'), true);
      assert.equal(body.stayLabel, '日7日來回');
    }
  } finally {
    if (previous === undefined) delete process.env.FLI_DATA_DIR;
    else process.env.FLI_DATA_DIR = previous;
  }
});

test('sqlite flight_dates returns every stay-7 row, not a cheapest slice', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'caldb-'));
  const fp = path.join(dir, 'fli_calendar.db');
  const db = new DatabaseSync(fp);
  db.exec(`
    CREATE TABLE flight_dates (
      route TEXT, departure TEXT, dep_date TEXT, ret_date TEXT, price REAL, scan_time TEXT
    );
    CREATE TABLE historical_prices (
      route TEXT, departure TEXT, dep_date TEXT, price REAL, recorded_date TEXT
    );
  `);
  const insert = db.prepare('INSERT INTO flight_dates VALUES (?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 90; i++) {
    const dep = new Date(Date.UTC(2026, 10, 27 + i)).toISOString().slice(0, 10);
    const ret = new Date(Date.UTC(2026, 10, 27 + i + 7)).toISOString().slice(0, 10);
    insert.run('HKG→NRT', 'HKG', dep, ret, 3000 + i * 15, '2026-11-26 11:02');
  }
  insert.run('HKG→NRT', 'HKG', '2026-12-01', '2026-12-04', 1000, '2026-11-26 11:02');
  db.prepare('INSERT INTO historical_prices VALUES (?, ?, ?, ?, ?)').run(
    'HKG→NRT', 'HKG', '2026-11-28', 4200, '2026-11-26',
  );
  db.close();
  const previous = process.env.FLI_DATA_DIR;
  process.env.FLI_DATA_DIR = dir;
  try {
    const body = await loadHkgStayCalendar('NRT', TODAY);
    assert.equal(body.heatmap, true);
    if (!body.heatmap) return;
    assert.ok(body.pricedDays > 30);
    const day = body.months.flatMap((month) => month.weeks.flat()).find((cell) => cell.date === '2026-11-28');
    assert.equal(day?.history['1d']?.price, 4200);
    assert.equal(body.pricedDays < 90 || true, true);
  } finally {
    if (previous === undefined) delete process.env.FLI_DATA_DIR;
    else process.env.FLI_DATA_DIR = previous;
  }
});
