// F-11: Anonymous impression/click counter for couple card ads.
// POST /match/api/ad-counter  body: { adId: string, field: 'impressions'|'clicks' }
//
// Anonymous (no session check) — these are analytics counters, not PII.
// Server uses the Admin SDK to atomically increment the field so concurrent
// requests can't lose updates. Rate-limited client-side by the existence of
// the ad in `seenAdIds` (impressions) and a single tap (clicks).

import { NextResponse } from 'next/server';
import { adminIncrementCounter } from '@/lib/firebase/admin';

export const runtime = 'nodejs'; // Admin SDK requires node runtime

const VALID_FIELDS = new Set(['impressions', 'clicks']);

export async function POST(request: Request) {
  let body: { adId?: string; field?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: '無效的請求' }, { status: 400 });
  }

  const { adId, field } = body;
  if (!adId || typeof adId !== 'string' || !adId.match(/^[a-zA-Z0-9_-]{1,64}$/)) {
    return NextResponse.json({ ok: false, error: 'invalid adId' }, { status: 400 });
  }
  if (!field || !VALID_FIELDS.has(field)) {
    return NextResponse.json(
      { ok: false, error: 'field must be "impressions" or "clicks"' },
      { status: 400 }
    );
  }

  try {
    const result = await adminIncrementCounter('coupleAds', adId, field, 1);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('ad-counter increment failed:', err);
    return NextResponse.json(
      { ok: false, error: 'increment failed' },
      { status: 500 }
    );
  }
}
