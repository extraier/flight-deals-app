// Hermes 2026-11-04: Serenity (trackserenity.com) endpoint.
//
// WHY THIS EXISTS
// ---------------
// src/app/trump/serenity-tabs.tsx used to do a STATIC import:
//
//     import serenityData from '@/data/serenity_data.json';
//
// A static import is baked into the Next.js bundle at BUILD time, so the
// Serenity tabs showed whatever JSON was in the bundle when it was last
// built -- the live /trump page was serving a 3-week-old copy.
//
// The fix mirrors /api/gflights, /api/alerts and /api/deals: read the
// file from disk at REQUEST time, with the bundled copy only as a
// fallback.
//
//   1. /volume1/flight-scanner/serenity_data.json  (live, pushed by
//      scanner/push_data_to_nas.sh)
//   2. <cwd>/src/data/serenity_data.json            (bundle fallback:
//      local dev, or if the NAS copy is missing)

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Serenity data is refreshed every 6h by com.comparetiger.serenity-sync,
// so a 30s cache is far fresher than the underlying data.
const CACHE_TTL_MS = 30_000;

// Hermes 2026-10-27: self-hosted on the NAS. FLI_DATA_DIR overrides for
// local dev (point it at ./src/data).
const FLI_DATA_DIR =
  process.env.FLI_DATA_DIR || '/volume1/flight-scanner';

export interface SerenityTweet {
  id: string;
  username: string;
  nickname: string;
  text: string;
  url: string;
  createdAt: string;
  displayTime: string;
  isRetweet: boolean;
  cashtags: string[];
  quotedTweet?: unknown;
  text_cn?: string;
}

export interface SerenityTicker {
  ticker: string;
  symbol: string;
  longName: string;
  exchange: string | null;
  currency: string;
  sector: string | null;
  relation: string | null;
  mention_date: string | null;
  mention_price: number | null;
  mention_price_source: string | null;
  current_price: number | null;
  return_pct: number | null;
  change: number | null;
  change_pct: number | null;
  day_high: number | null;
  day_low: number | null;
  previous_close: number | null;
  market_cap: number | null;
  pe_ttm: number | null;
  ps_ttm: number | null;
  weburl: string | null;
  logo: string | null;
  country: string | null;
  mention_count: number;
  tweet_ids: string[];
  stale: boolean;
}

export interface SerenityPayload {
  updated: string;
  source_updated_at: string;
  source_url: string;
  handle: string;
  nickname: string;
  posts: SerenityTweet[];
  rankings: SerenityTicker[];
  tickers: Record<string, SerenityTicker>;
  translations: Record<string, string>;
  stats: Record<string, number>;
}

const SERENITY_PATHS = [
  path.join(FLI_DATA_DIR, 'serenity_data.json'),
  // Fallback: the copy bundled with the build, used in local dev and as
  // a last resort if the NAS copy is missing.
  path.join(process.cwd(), 'src', 'data', 'serenity_data.json'),
];

interface CacheEntry {
  body: SerenityPayload;
  fetchedAt: number;
  source: 'nas-disk' | 'bundle-fallback';
}

let cached: CacheEntry | null = null;

async function loadSerenity(): Promise<CacheEntry> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }
  for (const [i, fp] of SERENITY_PATHS.entries()) {
    try {
      const raw = await fs.readFile(fp, 'utf-8');
      const parsed = JSON.parse(raw) as SerenityPayload;
      const entry: CacheEntry = {
        body: {
          updated: parsed.updated || '',
          source_updated_at: parsed.source_updated_at || '',
          source_url: parsed.source_url || '',
          handle: parsed.handle || '',
          nickname: parsed.nickname || '',
          posts: parsed.posts || [],
          rankings: parsed.rankings || [],
          tickers: parsed.tickers || {},
          translations: parsed.translations || {},
          stats: parsed.stats || {},
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
    body: {
      updated: '',
      source_updated_at: '',
      source_url: '',
      handle: '',
      nickname: '',
      posts: [],
      rankings: [],
      tickers: {},
      translations: {},
      stats: {},
    },
    fetchedAt: Date.now(),
    source: 'bundle-fallback',
  };
  cached = empty;
  return empty;
}

export async function GET() {
  const entry = await loadSerenity();
  return NextResponse.json(entry.body, {
    headers: {
      // Same rationale as /api/alerts: without an s-maxage this route
      // was re-invoked on every request. The underlying data changes
      // every 6h, so a 30s edge cache is far fresher than the data.
      'Cache-Control':
        'public, max-age=0, s-maxage=30, stale-while-revalidate=120',
      'X-Data-Source': entry.source,
    },
  });
}
