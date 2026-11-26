// Hermes 2026-11-04: Trump scanner endpoint.
//
// WHY THIS EXISTS
// ---------------
// src/app/trump/page.tsx used to do a STATIC import:
//
//     import trumpData from '@/data/trump_alerts.json';
//
// A static import is baked into the Next.js bundle at BUILD time. The
// scanner writes a fresh trump_alerts.json every day and pushes it to
// the NAS, but the running app kept serving whatever JSON happened to
// be in the bundle when it was last built -- so the page showed a
// timestamp days old.
//
// The fix mirrors /api/gflights and /api/alerts: read the file from
// disk at REQUEST time, with the bundled copy only as a fallback.
//
//   1. /volume1/flight-scanner/trump_alerts.json  (live, pushed by
//      scanner/push_data_to_nas.sh)
//   2. <cwd>/src/data/trump_alerts.json            (bundle fallback:
//      local dev, or if the NAS copy is missing)

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Trump data is refreshed once a day by the sync job, so a short cache
// is plenty. The page polls this route every 5 min.
const CACHE_TTL_MS = 30_000;

// Hermes 2026-10-27: self-hosted on the NAS. The scanner JSON sits on
// the same disk as this app, so read it from disk instead of from the
// bundle baked into the build. FLI_DATA_DIR overrides for local dev.
const FLI_DATA_DIR =
  process.env.FLI_DATA_DIR || '/volume1/flight-scanner';

export interface TrumpPost {
  id: number;
  link: string;
  text: string;
  date: string;
  source: string;
  image: string | null;
  has_image: boolean;
  text_cn?: string | null;
}

export interface TrumpFiling {
  ticker: string;
  company: string;
  transaction: string;
  range: string;
  date: string;
  trade_date: string;
  return_pct: string | null;
}

export interface TrumpTrade {
  stock: string;
  ticker: string;
  transaction: string;
  filed: string;
  traded: string;
  return_pct: number | null;
  source: string;
}

export interface TrumpPayload {
  updated: string;
  posts: TrumpPost[];
  filings: TrumpFiling[];
  quiver_trades: TrumpTrade[];
}

const TRUMP_PATHS = [
  path.join(FLI_DATA_DIR, 'trump_alerts.json'),
  // Fallback: the copy bundled with the build, used in local dev and as
  // a last resort if the NAS copy is missing.
  path.join(process.cwd(), 'src', 'data', 'trump_alerts.json'),
];

interface CacheEntry {
  body: TrumpPayload;
  fetchedAt: number;
  source: 'nas-disk' | 'bundle-fallback';
}

let cached: CacheEntry | null = null;

async function loadTrump(): Promise<CacheEntry> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }
  for (const [i, fp] of TRUMP_PATHS.entries()) {
    try {
      const raw = await fs.readFile(fp, 'utf-8');
      const parsed = JSON.parse(raw) as TrumpPayload;
      const entry: CacheEntry = {
        body: {
          updated: parsed.updated || '',
          posts: parsed.posts || [],
          filings: parsed.filings || [],
          quiver_trades: parsed.quiver_trades || [],
        },
        fetchedAt: Date.now(),
        source: i === 0 ? 'nas-disk' : 'bundle-fallback',
      };
      cached = entry;
      return entry;
    } catch {
      // try next path
    }
  }
  // Nothing readable anywhere -- return an empty but well-formed payload
  // so the page renders its empty state instead of crashing.
  const empty: CacheEntry = {
    body: { updated: '', posts: [], filings: [], quiver_trades: [] },
    fetchedAt: Date.now(),
    source: 'bundle-fallback',
  };
  cached = empty;
  return empty;
}

export async function GET() {
  const entry = await loadTrump();
  return NextResponse.json(entry.body, {
    headers: {
      // Same rationale as /api/alerts: without an s-maxage this route
      // was re-invoked on every request. The underlying data changes
      // once a day, so a 30s edge cache is far fresher than the data.
      'Cache-Control':
        'public, max-age=0, s-maxage=30, stale-while-revalidate=120',
      'X-Data-Source': entry.source,
    },
  });
}
