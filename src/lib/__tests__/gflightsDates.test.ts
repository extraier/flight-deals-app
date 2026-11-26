import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  correctedDepartureIso,
  departureIsPast,
  translateCity,
} from '../gflights_i18n.ts';

const NOV_26 = new Date('2026-11-26T04:00:00Z');
const NOV_ALERT = Date.parse('2026-11-15T02:00:00Z');
const OCT_ALERT = Date.parse('2026-10-20T02:00:00Z');

test('Jan and May emailed in Oct/Nov roll forward to 2027', () => {
  assert.equal(
    correctedDepartureIso({ dep_date: '2026-01-28', alert_unix_ms: NOV_ALERT }, NOV_26),
    '2027-01-28',
  );
  assert.equal(
    correctedDepartureIso({ dep_date: '2026-05-04', alert_unix_ms: OCT_ALERT }, NOV_26),
    '2027-05-04',
  );
});

test('the year fix is idempotent and a past same-month date stays hidden', () => {
  assert.equal(
    correctedDepartureIso({ dep_date: '2027-01-28', alert_unix_ms: NOV_ALERT }, NOV_26),
    '2027-01-28',
  );
  const earlyNov = correctedDepartureIso(
    { dep_date: '2026-11-01', alert_unix_ms: Date.parse('2026-11-20T02:00:00Z') },
    NOV_26,
  );
  assert.equal(earlyNov, '2026-11-01');
  assert.equal(departureIsPast(earlyNov!, NOV_26), true);
  assert.equal(departureIsPast('2027-01-28', NOV_26), false);
  assert.equal(departureIsPast('2026-12-20', NOV_26), false);
});

test('Google Flights city names use Chinese and a code only when it is reliable', () => {
  assert.equal(translateCity('Barcelona'), '巴塞羅那 (BCN)');
  assert.equal(translateCity('Los Angeles'), '洛杉磯 (LAX)');
  assert.equal(translateCity('Zürich'), '蘇黎世 (ZRH)');
  assert.equal(translateCity('Zurich'), '蘇黎世 (ZRH)');
  assert.equal(translateCity('Newark'), '紐瓦克 (EWR)');
  assert.equal(translateCity('Baltimore'), '巴爾的摩 (BWI)');
  assert.equal(translateCity('New York'), '紐約');
  assert.equal(translateCity('Hong Kong'), '香港 (HKG)');
});
