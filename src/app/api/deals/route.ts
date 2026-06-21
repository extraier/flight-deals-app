/**
 * Flight deals API route.
 *
 * Fetches live data from the UGREEN NAS via Tailscale Funnel
 * (https://ugreen-nas.tail20bf1.ts.net/...) with a 60-second in-memory cache.
 * Falls back to the bundled static JSON if the upstream is unreachable.
 *
 * Why this exists: removes the need to git-push + Vercel-deploy every time
 * the scanner finishes a cycle. Now data updates appear within ~5 minutes
 * (worst case ~60s cache + 1 funnel hop) without touching the repo.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FUNNEL_BASE = 'https://ugreen-nas.tail20bf1.ts.net';
const CACHE_TTL_MS = 60_000; // 60 seconds
const UPSTREAM_TIMEOUT_MS = 8_000; // Vercel hobby default is 10s; leave headroom

type Departure = 'HKG' | 'SZX';

interface CacheEntry {
  body: unknown;
  fetchedAt: number;
  source: 'funnel' | 'static-fallback';
  upstreamMtime: number | null;
}

const cache = new Map<Departure, CacheEntry>();

const STATIC_FALLBACK: Record<Departure, string> = {
  HKG: 'all_dates.json',
  SZX: 'all_dates_szx.json',
};

async function readStaticFallback(dep: Departure): Promise<unknown> {
  const filename = STATIC_FALLBACK[dep];
  const fp = path.join(process.cwd(), 'src', 'data', filename);
  const raw = await fs.readFile(fp, 'utf-8');
  return JSON.parse(raw);
}

async function fetchFromFunnel(dep: Departure, signal: AbortSignal): Promise<{ body: unknown; mtime: number | null }> {
  const url = `${FUNNEL_BASE}/all_dates${dep === 'SZX' ? '_szx' : ''}.json`;
  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': 'flight-deals-app/1.0 (vercel-edge)' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`upstream ${res.status} ${res.statusText} for ${url}`);
  }
  const body = await res.json();
  const mtimeHeader = res.headers.get('x-file-mtime');
  const mtime = mtimeHeader ? Number(mtimeHeader) : null;
  return { body, mtime };
}

async function getDeals(dep: Departure, force = false): Promise<CacheEntry> {
  const now = Date.now();
  const cached = cache.get(dep);
  if (!force && cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const { body, mtime } = await fetchFromFunnel(dep, ac.signal);
    const entry: CacheEntry = { body, fetchedAt: now, source: 'funnel', upstreamMtime: mtime };
    cache.set(dep, entry);
    return entry;
  } catch (err) {
    console.warn(`[api/deals] funnel fetch failed for ${dep}:`, err);
    // Fall back to static JSON if we have nothing fresh
    const body = await readStaticFallback(dep);
    const entry: CacheEntry = {
      body,
      fetchedAt: now,
      source: 'static-fallback',
      upstreamMtime: null,
    };
    // Don't cache the fallback for the full TTL — try again next request
    entry.fetchedAt = now - (CACHE_TTL_MS / 2); // expire halfway
    cache.set(dep, entry);
    return entry;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const depParam = (searchParams.get('dep') || 'HKG').toUpperCase() as Departure;
  const force = searchParams.get('force') === '1';
  const healthOnly = searchParams.get('health') === '1';

  if (healthOnly) {
    const cacheOut: Record<string, unknown> = {};
    for (const dep of ['HKG', 'SZX'] as Departure[]) {
      const c = cache.get(dep);
      cacheOut[dep] = c
        ? {
            source: c.source,
            ageSec: Math.round((Date.now() - c.fetchedAt) / 1000),
            upstreamMtime: c.upstreamMtime,
          }
        : null;
    }
    return Response.json(
      { ok: true, cache: cacheOut, funnel: FUNNEL_BASE },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (depParam !== 'HKG' && depParam !== 'SZX') {
    return Response.json({ error: `invalid departure: ${depParam}` }, { status: 400 });
  }

  try {
    const entry = await getDeals(depParam, force);
    return Response.json(entry.body, {
      headers: {
        // Short edge cache so bursts of visitors don't all hit Lambda
        'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=120',
        'X-Data-Source': entry.source,
        'X-Data-Age-Ms': String(Date.now() - entry.fetchedAt),
        ...(entry.upstreamMtime ? { 'X-Upstream-Mtime': String(entry.upstreamMtime) } : {}),
      },
    });
  } catch (err) {
    console.error('[api/deals] unhandled error:', err);
    return Response.json(
      { error: 'failed to fetch deals', detail: String(err) },
      { status: 500 },
    );
  }
}
