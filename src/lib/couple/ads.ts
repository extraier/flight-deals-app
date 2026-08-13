// F-11: Ad impression/click telemetry. Fire-and-forget to the server-side
// /match/api/ad-counter endpoint. No auth — anonymous analytics.
//
// Dedup is the client's responsibility:
//   - impressions: the parent component already tracks seenAdIds to avoid
//     showing the same ad twice per session. Don't call recordAdImpression
//     twice with the same adId from the same session.
//   - clicks: a single tap opens the URL once. Safe to call every tap.

export type AdMetricField = 'impressions' | 'clicks';

/**
 * Fire-and-forget increment of an ad counter. Failures are logged but never
 * thrown — analytics shouldn't break the room UX.
 */
export function recordAdMetric(adId: string, field: AdMetricField): void {
  if (!adId || (field !== 'impressions' && field !== 'clicks')) return;
  if (typeof window === 'undefined') return; // SSR safety
  try {
    fetch('/match/api/ad-counter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adId, field }),
      keepalive: true,
    }).catch(() => {
      // swallow — analytics only
    });
  } catch {
    // swallow
  }
}
