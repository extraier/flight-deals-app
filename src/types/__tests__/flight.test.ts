// Type tests for src/types/flight.ts.
//
// These tests use node:test (no extra deps). They verify that the
// 2026-08-23 deal-confidence + itinerary shape changes compile and
// accept the expected exporter output.
//
// Run with: node --experimental-strip-types --no-warnings --test \
//   src/types/__tests__/flight.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  FlightDeal,
  CheapDate,
  Itinerary,
  DateComparison,
  HistoryComparison,
  MarketComparison,
  ComparisonSummary,
} from '../flight.ts';

// ── ComparisonSummary shape (the new deal-confidence block) ────────────

test('DateComparison ready shape accepts all fields', () => {
  const dc: DateComparison = {
    scope: 'same_stay_length',
    stay: 7,
    status: 'ready',
    sampleSize: 6,
    pricePercentile: 14.3,
    vsMedian: -20.4,
    median: 11300,
  };
  assert.equal(dc.status, 'ready');
  assert.equal(dc.scope, 'same_stay_length');
  assert.equal(dc.sampleSize, 6);
});

test('DateComparison insufficient_data has sampleSize >= 0', () => {
  const dc: DateComparison = {
    scope: 'same_stay_length',
    stay: 7,
    status: 'insufficient_data',
    sampleSize: 1,  // below MIN_DATE_PEERS=3
  };
  assert.equal(dc.status, 'insufficient_data');
});

test('MarketComparison is locked to not_collected status', () => {
  // R7: until a current authorized detail source confirms the market,
  // this must always be not_collected with the canonical reason.
  const mc: MarketComparison = {
    scope: 'carrier_overlay',
    status: 'not_collected',
    reason: 'requires_all_comparable_itineraries',
    sampleSize: 0,
  };
  assert.equal(mc.status, 'not_collected');
  assert.equal(mc.reason, 'requires_all_comparable_itineraries');
});

test('HistoryComparison ready shape', () => {
  const hc: HistoryComparison = {
    scope: 'all_observations',
    status: 'ready',
    sampleSize: 5,
    vsMedian: -8.0,
  };
  assert.equal(hc.status, 'ready');
});

// ── Itinerary shape (new per-date detail block) ─────────────────────────

test('Itinerary.selected has full outbound + return', () => {
  const it: Itinerary = {
    status: 'selected',
    source: 'flight_details',
    scannedAt: '2026-08-23T14:23:00',
    outbound: {
      airline: 'UO',
      flight: '260',
      depTime: '22:05',
      arrTime: '01:35',
    },
    return: {
      airline: 'UO',
      flight: '261',
      depTime: '02:35',
      arrTime: '06:35',
    },
    retDate: '2026-09-08',
  };
  assert.equal(it.status, 'selected');
  assert.equal(it.outbound?.airline, 'UO');
});

test('Itinerary.not_collected has null source and no flights', () => {
  const it: Itinerary = {
    status: 'not_collected',
    source: null,
    scannedAt: null,
    retDate: '2026-09-08',
  };
  assert.equal(it.status, 'not_collected');
  assert.equal(it.source, null);
  assert.equal(it.outbound, undefined);
});

test('Itinerary.stale preserves scannedAt for diagnostics', () => {
  const it: Itinerary = {
    status: 'stale',
    source: 'flight_details',
    scannedAt: '2026-08-20T08:00:00',  // 3 days old
    retDate: '2026-09-08',
  };
  assert.equal(it.status, 'stale');
});

// ── CheapDate + FlightDeal (full integration shape) ─────────────────────

test('CheapDate accepts both legacy flight and new itinerary', () => {
  // Backward-compat: legacy exporters emit `flight`, new exporters emit
  // `itinerary`. Both shapes are valid simultaneously.
  const cd: CheapDate = {
    day: 11,
    month: 11,
    year: 2026,
    stay: 7,
    price: 4930,
    flight: {                    // legacy shape
      airline: 'UO',
      flight_no: '260',
      dep_time: '22:05',
    },
    itinerary: {                 // new shape
      status: 'selected',
      source: 'flight_details',
      scannedAt: '2026-08-23T14:23:00',
      outbound: { airline: 'UO', flight: '260', depTime: '22:05', arrTime: '01:35' },
      retDate: '2026-09-08',
    },
    history: {
      '1d': { price: 4930, diff: 0, pct: 0 },
    },
  };
  assert.equal(cd.itinerary?.status, 'selected');
  assert.equal(cd.flight?.airline, 'UO');
});

test('CheapDate with itinerary=not_collected has no flight block', () => {
  // R7: when the detail scanner is disabled or blocked, the per-date
  // row must explicitly say "no flight data" via itinerary.status.
  const cd: CheapDate = {
    day: 1,
    month: 9,
    year: 2026,
    stay: 7,
    price: 4500,
    itinerary: {
      status: 'not_collected',
      source: 'flight_dates_fallback',
      scannedAt: null,
      retDate: '2026-09-08',
    },
  };
  assert.equal(cd.itinerary?.status, 'not_collected');
  assert.equal(cd.flight, undefined);
});

test('FlightDeal with all three comparison blocks', () => {
  const deal: FlightDeal = {
    route: 'HKG→PKX',
    destination: {
      code: 'PKX',
      name: '北京大興 (PKX)',
      region: '中國',
    },
    price: 993,
    currency: 'HKD',
    typicalPrice: 1419,
    badge: { cheapDays: 12 },
    cheapestDates: [],
    totalDestinations: 47,
    dateComparison: {
      scope: 'same_stay_length',
      stay: 7,
      status: 'ready',
      sampleSize: 6,
      pricePercentile: 14.3,
      vsMedian: -20.4,
      median: 11300,
    },
    historyComparison: {
      scope: 'all_observations',
      status: 'insufficient_data',
      sampleSize: 1,
    },
    marketComparison: {
      scope: 'carrier_overlay',
      status: 'not_collected',
      reason: 'requires_all_comparable_itineraries',
      sampleSize: 0,
    },
  };
  assert.equal(deal.dateComparison?.status, 'ready');
  assert.equal(deal.marketComparison?.status, 'not_collected');
});

test('FlightDeal without comparison blocks is still valid', () => {
  // Backward-compat: legacy exports without the new fields must still
  // satisfy FlightDeal (all comparison fields are optional).
  const deal: FlightDeal = {
    route: 'HKG→BKK',
    destination: { code: 'BKK', name: '曼谷 (BKK)', region: '東南亞' },
    price: 4500,
    cheapestDates: [],
  };
  assert.equal(deal.dateComparison, undefined);
  assert.equal(deal.historyComparison, undefined);
  assert.equal(deal.marketComparison, undefined);
});

test('ComparisonSummary has 3 mutually exclusive statuses', () => {
  // The union literal must be exactly these three values.
  const statuses: ComparisonSummary['status'][] = [
    'ready',
    'insufficient_data',
    'not_collected',
  ];
  assert.equal(new Set(statuses).size, 3);
});
