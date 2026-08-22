/**
 * Hermes 2026-08-22 (Manus Defect B + admin page fix):
 *   Single, pure normalization function used by every admin metrics
 *   display, CTR sort, and aggregate calculation. Centralizing it here
 *   prevents the split behavior that caused `CTR: NaN%` cards when one
 *   renderer used safe coercion and another used raw division.
 *
 *   Incomplete or non-numeric Firestore values produce safe numbers
 *   (never NaN, Infinity, or negative counts).
 */

export type AdMetricInput = {
  impressions?: unknown;
  clicks?: unknown;
};

export type AdMetrics = {
  impressions: number;
  clicks: number;
  ctr: number; // percentage, 0 when impressions === 0
};

function nonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function normalizedAdMetrics(ad: AdMetricInput): AdMetrics {
  const impressions = nonNegativeNumber(ad.impressions);
  const clicks = nonNegativeNumber(ad.clicks);
  return {
    impressions,
    clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
  };
}