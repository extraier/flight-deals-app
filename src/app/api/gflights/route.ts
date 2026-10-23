// Hermes 2026-10-17: Google Flights digest endpoint.
// Returns the parsed deals from gflights_digest.json (committed to git).
// 24h GC: filters out deals whose first_seen is older than 24h.

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL_MS = 5_000;

// Hermes 2026-10-19: define proper types instead of `any`. The shape
// mirrors what scanner/gflights_parser.py writes into
// src/data/gflights_digest.json.
export interface GFlightDeal {
  origin: string;
  destination: string;
  destination_name: string;
  date_range: string;
  price: number;
  save_pct: number | null;
  airline: string | null;
  stops: number | null;
  duration_min: number | null;
  url: string;
  email_id: string;
  first_seen: string;
}

export interface GFlightsFile {
  generated: string;
  source: string;
  deals: GFlightDeal[];
  count: number;
}

let cached: { body: GFlightsFile; fetchedAt: number } | null = null;

async function loadDigest(): Promise<GFlightsFile> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.body;
  }
  const fp = path.join(process.cwd(), 'src', 'data', 'gflights_digest.json');
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    const body: GFlightsFile = JSON.parse(raw);
    cached = { body, fetchedAt: Date.now() };
    return body;
  } catch {
    return { generated: new Date().toISOString(), source: 'gmail://noreply-travel@google.com', deals: [], count: 0 };
  }
}

function filterExpired(deals: GFlightDeal[]): GFlightDeal[] {
  // Hermes 2026-10-19: widened from 24h to 7d to match the cron window
  // (`scanner/gflights_poller.py --days 7`). The poller fetches 7 days of
  // emails, so the JSON stores up to 7-day-old alerts. Previously the
  // 24h gate silently dropped everything older than a day, which made
  // ~80% of the corpus invisible on /gflights and made the user think
  // the cron was broken. The previous "Hermes 2026-10-17" comment was
  // a wrong-first-attempt that masked the bug for 2 days.
  const nowMs = Date.now();
  const windowMs = 7 * 24 * 60 * 60 * 1000;
  return deals.filter((d) => {
    if (!d.first_seen) return true;
    const firstMs = Date.parse(d.first_seen);
    return !isNaN(firstMs) && (nowMs - firstMs) < windowMs;
  });
}

export async function GET(req: NextRequest) {
  const body = await loadDigest();
  const url = new URL(req.url);
  const origin = url.searchParams.get('origin') || '';
  const dest = url.searchParams.get('destination') || '';

  let deals = filterExpired(body.deals || []);
  if (origin) deals = deals.filter((d) => d.origin === origin);
  if (dest) deals = deals.filter((d) =>
    d.destination_name.toLowerCase().includes(dest.toLowerCase()));

  return NextResponse.json(
    {
      generated: body.generated,
      source: body.source,
      deals,
      count: deals.length,
    },
    {
      headers: {
        // Hermes 2026-10-23: CDN-cacheable.
        //
        // Same problem as /api/alerts — without s-maxage this route returned
        // "max-age=0, must-revalidate" on every request → x-vercel-cache: MISS
        // → one Lambda invocation per hit. The /gflights page polls this
        // route every 5 minutes, and the hourly poll+deploy cycle guarantees
        // a cold cache right after every deploy.
        //
        // The digest is refreshed hourly by the gflights poller, so a 30s
        // edge cache is far fresher than the data itself.
        'Cache-Control':
          'public, max-age=0, s-maxage=30, stale-while-revalidate=120',
      },
    },
  );
}
