import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixCityName } from '../cityNames.ts';
import { homeSavingsText, leadAirlineLabel, leadFareDateLabel } from '../homeCards.ts';

const AIRLINES: Record<string, string> = { CX: '國泰', UO: '香港快運' };

test('city titles keep the airport code and correct the two spellings', () => {
  assert.equal(fixCityName('馬尼拉 (MNL)'), '馬尼拉 (MNL)');
  assert.equal(fixCityName('東京 (NRT)'), '東京 (NRT)');
  assert.equal(fixCityName('東京 (HND)'), '東京 (HND)');
  assert.equal(fixCityName('巴塞羅拿 (BCN)'), '巴塞羅那 (BCN)');
  assert.equal(fixCityName('洛杉矶 (LAX)'), '洛杉磯 (LAX)');
  assert.equal(fixCityName('洛杉矶'), '洛杉磯');
});

test('lead fare dates come from the stored departure and stay', () => {
  assert.equal(
    leadFareDateLabel({ year: 2026, month: 10, day: 27, stay: 7 }),
    '2026年10月27日–11月3日',
  );
  assert.equal(
    leadFareDateLabel({ year: 2026, month: 12, day: 8, stay: 7 }),
    '2026年12月8日–15日',
  );
  assert.equal(
    leadFareDateLabel({ year: 2026, month: 12, day: 28, stay: 7 }),
    '2026年12月28日–2027年1月4日',
  );
  assert.equal(leadFareDateLabel({ year: 2026, month: 11, day: 2 }), '2026年11月2日');
  assert.equal(leadFareDateLabel(undefined), '');
});

test('lead airline uses the site Chinese name and is omitted when missing', () => {
  assert.equal(leadAirlineLabel({ flight: { airline: 'CX' } }, AIRLINES), '國泰');
  assert.equal(leadAirlineLabel({ flight: { airline: '_UO' } }, AIRLINES), '香港快運');
  assert.equal(
    leadAirlineLabel({ itinerary: { outbound: { airline: 'CX' } } }, AIRLINES),
    '國泰',
  );
  assert.equal(leadAirlineLabel({ flight: { airline: 'ZZ' } }, AIRLINES), 'ZZ');
  assert.equal(leadAirlineLabel({ flight: null }, AIRLINES), null);
  assert.equal(leadAirlineLabel(undefined, AIRLINES), null);
});

test('今日 labels the typical-price discount, and a day chip labels that history price', () => {
  // 馬尼拉: $935 vs typical $1,547 → 40% under the scanned average.
  assert.equal(homeSavingsText(935, 1547, 'now', null), '較平時低 40%');
  // Same fare vs its 4-day history price $1,395 → 33% under, not the typical 40%.
  assert.equal(homeSavingsText(935, 1547, '4d', 1395), '較4日低 33%');
  assert.equal(homeSavingsText(935, 1547, '7d', 1100), '較7日低 15%');
  assert.equal(homeSavingsText(935, 1547, '1d', 1135), '較1日低 18%');
  // No history for the selected window: do not borrow the typical baseline.
  assert.equal(homeSavingsText(935, 1547, '7d', null), null);
  // Not cheaper than the selected baseline: no "低" label.
  assert.equal(homeSavingsText(1600, 1547, 'now', null), null);
  assert.equal(homeSavingsText(1200, 1547, '7d', 1100), null);
});
