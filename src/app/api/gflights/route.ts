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

// Hermes 2026-10-27: self-hosted on the NAS. The digest is produced by the
// Mac-side Gmail poller and pushed to the NAS, so the app reads it from
// disk instead of from the bundle baked into the build.
//
// Previously the flow was: poller → git commit → Vercel deploy → new
// bundle containing the new JSON. That cost one Vercel deploy per poll
// (~27/day) purely to move a data file, which is what the user wanted to
// stop. Now the poller scps the JSON to the NAS and the running app picks
// it up on the next cache expiry — no deploy, no git, no quota burn.
//
// FLI_DATA_DIR can override for local dev; it defaults to the NAS path.
const FLI_DATA_DIR =
  process.env.FLI_DATA_DIR || '/volume1/flight-scanner';

const DIGEST_PATHS = [
  path.join(FLI_DATA_DIR, 'gflights_digest.json'),
  // Fallback: the copy bundled with the build, used in local dev and as
  // a last resort if the NAS copy is missing.
  path.join(process.cwd(), 'src', 'data', 'gflights_digest.json'),
];

async function loadDigest(): Promise<GFlightsFile> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.body;
  }
  for (const fp of DIGEST_PATHS) {
    try {
      const raw = await fs.readFile(fp, 'utf-8');
      const body: GFlightsFile = JSON.parse(raw);
      cached = { body, fetchedAt: Date.now() };
      return body;
    } catch {
      // try next path
    }
  }
  return { generated: new Date().toISOString(), source: 'gmail://noreply-travel@google.com', deals: [], count: 0 };
}

function filterExpired(deals: GFlightDeal[]): GFlightDeal[] {
  // Hermes 2026-11-08: widened from 7d to 30d to match the cron window
  // (`scanner/gflights_poller.py --days 30`). The poller fetches 30 days of
  // emails, so the JSON stores up to 30-day-old alerts. Previously the
  // 7d gate hid older digests even when Gmail still had them.
  // (History: 24h → 7d on 2026-10-19; 7d → 30d on 2026-11-08.)
  const nowMs = Date.now();
  const windowMs = 30 * 24 * 60 * 60 * 1000;
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
