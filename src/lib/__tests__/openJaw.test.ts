// Extreme 開口機票 threshold.
//
// Run with:
//   node --experimental-strip-types --no-warnings --test src/lib/__tests__/openJaw.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bareCityName,
  formatSavingPct,
  hasIataLeak,
  isExtremeOpenJawSaving,
  selectExtremeOpenJawDeals,
  visibleOpenJawCards,
  type OpenJawCard,
} from '../openJaw.ts';

/** The live sample: 潞州–巴黎, 16–26 Dec 2026, package HK$6,253 vs direct HK$7,125 (12.2%). */
function luzhouParisSample(overrides: Record<string, unknown> = {}) {
  return {
    origin: { code: 'LZO', name: '潞州 (LZO)' },
    destination: { code: 'CDG', name: '巴黎 (CDG)' },
    depart_date: '2026-12-16',
    return_date: '2026-12-26',
    ita: { price: 4913, origin: 'LZO', destination: 'CDG' },
    positioning: {
      from: 'HKG',
      to: 'LZO',
      airline: 'CX',
      date: '2026-12-16',
      price: 1340,
    },
    package_total: 6253,
    hkg_direct_baseline: { price: 7125 },
    // Scanner's own 10% / HK$500 flag would mark this. The page must not.
    flag: { saving_pct: 12.2, saving_hkd: 872, flagged: true },
    ...overrides,
  };
}

function report(rows: unknown[]) {
  return {
    date: '2026-11-26',
    searchedAt: '2026-11-26T02:00:00+08:00',
    timezone: 'Asia/Hong_Kong',
    windows: [],
    stay_nights: 10,
    currency: 'HKD',
    kill_switch: false,
    ita_stats: {},
    flag_rule: { min_saving_pct: 10, min_saving_hkd: 500 },
    caveats: [],
    rows,
  };
}

function assertNoIata(card: OpenJawCard) {
  for (const value of [card.title, card.originCity, card.destinationCity, card.dateLabel, card.positioningSummary || '']) {
    assert.equal(hasIataLeak(value), false, value);
  }
}

test('12.2% is not extreme and 70% exactly is not either', () => {
  assert.equal(isExtremeOpenJawSaving(12.2), false);
  assert.equal(isExtremeOpenJawSaving(70), false);
  assert.equal(isExtremeOpenJawSaving(70.01), true);
  assert.equal(isExtremeOpenJawSaving(81.25), true);
});

test('the 潞州–巴黎 12.2% sample does not become a card', () => {
  const view = selectExtremeOpenJawDeals(report([luzhouParisSample()]));
  assert.equal(view.scanned, 1);
  assert.equal(view.deals.length, 0);
  assert.equal(visibleOpenJawCards(view.deals).length, 0);
});

test('a scanner flag cannot promote a 12.2% fare or hide an 80% fare', () => {
  const view = selectExtremeOpenJawDeals(report([
    luzhouParisSample(),
    {
      origin: { code: 'LIS', name: '里斯本 (LIS)' },
      destination: { code: 'FCO', name: '羅馬 (FCO)' },
      depart_date: '2026-12-01',
      return_date: '2026-12-11',
      ita: { price: 900, origin: 'LIS', destination: 'FCO' },
      positioning: { from: 'SZX', to: 'LIS', airline: 'CX', date: '2026-12-01', price: 600 },
      package_total: 1500,
      hkg_direct_baseline: { price: 8000 },
      // Contradicts the prices. Prices win: (8000 - 1500) / 8000 = 81.25%.
      flag: { saving_pct: 12.2, saving_hkd: 100, flagged: false },
    },
  ]));

  assert.equal(view.deals.length, 1);
  const card = view.deals[0];
  assert.equal(card.originCity, '里斯本');
  assert.equal(card.destinationCity, '羅馬');
  assert.equal(card.title, '里斯本 → 羅馬');
  assert.equal(card.dateLabel, '2026年12月1日至11日');
  assert.equal(card.packagePrice, 1500);
  assert.equal(card.directPrice, 8000);
  assert.ok(card.savingPct > 70);
  assert.equal(formatSavingPct(card.savingPct), '81.3');
  assert.match(card.positioningSummary || '', /深圳 → 里斯本/);
  assert.match(card.positioningSummary || '', /國泰/);
  assert.match(card.positioningSummary || '', /HK\$600/);
  assertNoIata(card);
  assert.equal(card.title.includes('LIS'), false);
  assert.equal(card.title.includes('FCO'), false);
  assert.equal((card.positioningSummary || '').includes('SZX'), false);
  assert.equal((card.positioningSummary || '').includes('CX'), false);
});

test('exactly 70% is hidden and just over 70% is shown', () => {
  const exact = luzhouParisSample({
    ita: { price: 2000, origin: 'LIS', destination: 'CDG' },
    positioning: { from: 'HKG', to: 'LIS', price: 1000 },
    package_total: 3000,
    hkg_direct_baseline: { price: 10000 },
    flag: { saving_pct: 70, saving_hkd: 7000, flagged: true },
  });
  const justOver = luzhouParisSample({
    origin: { name: '里斯本' },
    destination: { name: '巴黎' },
    ita: { price: 1999 },
    positioning: { from: '香港', to: '里斯本', price: 1000 },
    package_total: 2999,
    hkg_direct_baseline: { price: 10000 },
    flag: { saving_pct: 10, flagged: false },
  });
  const view = selectExtremeOpenJawDeals(report([exact, justOver]));
  assert.equal(view.deals.length, 1);
  assert.equal(view.deals[0].originCity, '里斯本');
  assert.equal(view.deals[0].destinationCity, '巴黎');
  assert.ok(view.deals[0].savingPct > 70);
  assert.ok(view.deals[0].savingPct < 70.1);
});

test('ita.price + positioning.price is the package, not a stale package_total', () => {
  const view = selectExtremeOpenJawDeals(report([
    luzhouParisSample({ package_total: 1000 }),
  ]));
  assert.equal(view.deals.length, 0);
});

test('bare Chinese names only, including when the report has codes alone', () => {
  const view = selectExtremeOpenJawDeals(report([
    {
      ita: { price: 100, origin: 'LIS', destination: 'CDG' },
      positioning: { from: 'HKG', to: 'LIS', airline: 'TP', price: 100, date: '2026-12-16' },
      hkg_direct_baseline: { price: 1000 },
      date_range: '16–26 Dec 2026',
      flag: { saving_pct: 10, flagged: false },
    },
    {
      ita: { price: 100, origin: 'XYZ', destination: 'CDG' },
      positioning: { from: 'SZX', to: 'XYZ', price: 50 },
      package_total: 150,
      hkg_direct_baseline: { price: 1000 },
      depart_date: '2026-12-16',
      return_date: '2026-12-26',
    },
  ]));
  assert.equal(view.deals.length, 2);
  const lisbon = view.deals.find((card) => card.originCity === '里斯本');
  const unknown = view.deals.find((card) => card.originCity === '未知城市');
  assert.ok(lisbon);
  assert.equal(lisbon.title, '里斯本 → 巴黎');
  assert.equal(lisbon.dateLabel, '2026年12月16日至26日');
  assert.match(lisbon.positioningSummary || '', /香港 → 里斯本/);
  assert.equal((lisbon.positioningSummary || '').includes('TP'), false);
  assert.equal(unknown?.destinationCity, '巴黎');
  for (const card of view.deals) assertNoIata(card);
  assert.equal(JSON.stringify(view).includes('XYZ'), false);
  assert.equal(JSON.stringify(view.deals).includes('HKG'), false);
  assert.equal(JSON.stringify(view.deals).includes('CDG'), false);
});

test('深圳 can be the open-jaw city, not only the home airport', () => {
  const view = selectExtremeOpenJawDeals(report([
    {
      ita: { price: 200, origin: 'SZX', destination: 'NRT' },
      positioning: { from: 'HKG', to: 'SZX', price: 100 },
      hkg_direct_baseline: { price: 2000 },
      depart_date: '2026-12-02',
      return_date: '2026-12-09',
    },
  ]));
  assert.equal(view.deals.length, 1);
  assert.equal(view.deals[0].title, '深圳 → 東京');
  assert.match(view.deals[0].positioningSummary || '', /香港 → 深圳/);
  assertNoIata(view.deals[0]);
});

test('city helper strips parenthetical codes and translates known names', () => {
  assert.equal(bareCityName('潞州 (LZO)'), '潞州');
  assert.equal(bareCityName('巴黎 (CDG)'), '巴黎');
  assert.equal(bareCityName('HKG'), '香港');
  assert.equal(bareCityName('Hong Kong'), '香港');
  assert.equal(bareCityName('Paris'), '巴黎');
  assert.equal(bareCityName({ code: 'CDG', name: '巴黎 (CDG)' }), '巴黎');
});

test('a hand-built 12.2% card is not visible and an 80% card is', () => {
  const mild: OpenJawCard = {
    id: 'mild',
    title: '潞州 → 巴黎',
    originCity: '潞州',
    destinationCity: '巴黎',
    dateLabel: '2026年12月16日至26日',
    positioningSummary: '定位：香港 → 潞州 · HK$1,340',
    packagePrice: 6253,
    directPrice: 7125,
    savingPct: 12.2,
    savingHkd: 872,
  };
  const extreme: OpenJawCard = { ...mild, id: 'extreme', savingPct: 80, packagePrice: 1425 };
  const visible = visibleOpenJawCards([mild, extreme]);
  assert.deepEqual(visible.map((card) => card.id), ['extreme']);
});
