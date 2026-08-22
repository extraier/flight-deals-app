/**
 * Hermes 2026-08-22 (Manus Defect B regression):
 *   Fail if a future change returns NaN, Infinity, a negative count,
 *   or a non-zero CTR with zero impressions.
 */
import { normalizedAdMetrics } from '../adminMetrics';

describe('normalizedAdMetrics', () => {
  test.each<[unknown, { impressions: number; clicks: number; ctr: number }]>([
    [{}, { impressions: 0, clicks: 0, ctr: 0 }],
    [{ impressions: undefined, clicks: undefined }, { impressions: 0, clicks: 0, ctr: 0 }],
    [{ impressions: 2, clicks: undefined }, { impressions: 2, clicks: 0, ctr: 0 }],
    [{ impressions: '2', clicks: '1' }, { impressions: 2, clicks: 1, ctr: 50 }],
    [{ impressions: 'bad', clicks: 4 }, { impressions: 0, clicks: 4, ctr: 0 }],
    [{ impressions: -1, clicks: -2 }, { impressions: 0, clicks: 0, ctr: 0 }],
    [{ impressions: 0, clicks: 5 }, { impressions: 0, clicks: 5, ctr: 0 }],
    [{ impressions: NaN, clicks: 3 }, { impressions: 0, clicks: 3, ctr: 0 }],
    [{ impressions: null, clicks: null }, { impressions: 0, clicks: 0, ctr: 0 }],
  ])('normalizes %o safely', (input, expected) => {
    const actual = normalizedAdMetrics(input as { impressions?: unknown; clicks?: unknown });
    expect(actual).toEqual(expected);
    expect(Number.isFinite(actual.ctr)).toBe(true);
    expect(Number.isFinite(actual.impressions)).toBe(true);
    expect(Number.isFinite(actual.clicks)).toBe(true);
  });
});