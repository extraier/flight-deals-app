/**
 * Flight deals API route.
 *
 * Hermes 2026-07-01: rewrote upstream strategy.
 *   1. Try Tailscale Funnel (https://ugreen-nas.tail20bf1.ts.net) — same-LAN fast path.
 *      Often unreachable from Vercel edge workers because Tailscale peer discovery
 *      fails across regions.
 *   2. Fall back to public HTTPS CDN (cdn.savetheday.io/deals) — reachable
 *      from anywhere, served via nginx on the NAS fronted by cloudflared.
 *      This is the new primary on Vercel since the funnel breaks.
 *   3. Last resort: bundled static JSON in src/data/.
 *
 * Cache: 60s in-memory. The 90s page refresh interval plus the CDN's 300s
 * max-age mean we never hammer upstream.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FUNNEL_BASE = 'https://ugreen-nas.tail20bf1.ts.net';
const CDN_BASE = 'https://cdn.savetheday.io/deals';
const CACHE_TTL_MS = 20_000; // 20 seconds — Hermes 2026-07-09 dropped from
// 60s so the deals page's 20s poll cycle actually sees fresh data each tick.
// The upstream funnel/CDN has its own ~300s max-age so we never hammer it.
const UPSTREAM_TIMEOUT_MS = 8_000; // Vercel hobby default is 10s; leave headroom

type Departure = 'HKG' | 'SZX';

interface CacheEntry {
  body: unknown;
  fetchedAt: number;
  source: 'funnel' | 'cdn' | 'static-fallback';
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

/**
 * Try upstreams in order: funnel first (fastest when reachable), then public
 * CDN. Returns the first successful response. Throws if all upstream fetches
 * failed so the static-fallback path can run.
 */
async function fetchFromAnyUpstream(
  dep: Departure,
  parentSignal: AbortSignal,
): Promise<{ body: unknown; mtime: number | null; source: 'funnel' | 'cdn' }> {
  const upstreams: { name: 'funnel' | 'cdn'; url: string }[] = [
    {
      name: 'funnel',
      url: `${FUNNEL_BASE}/all_dates${dep === 'SZX' ? '_szx' : ''}.json`,
    },
    {
      name: 'cdn',
      url: `${CDN_BASE}/all_dates${dep === 'SZX' ? '_szx' : ''}.json`,
    },
  ];

  const errors: unknown[] = [];
  for (const u of upstreams) {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
    const abortParent = () => ac.abort();
    parentSignal.addEventListener('abort', abortParent);
    try {
      const res = await fetch(u.url, {
        signal: ac.signal,
        headers: { 'User-Agent': 'flight-deals-app/1.1 (vercel-edge)' },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`upstream ${res.status} ${res.statusText}`);
      const body = await res.json();
      const mtime = Number(res.headers.get('x-file-mtime') ?? 0) || null;
      return { body, mtime, source: u.name };
    } catch (err) {
      errors.push({ source: u.name, err });
    } finally {
      clearTimeout(timeout);
      parentSignal.removeEventListener('abort', abortParent);
    }
  }
  // All upstreams failed — throw the last error so the static fallback runs.
  throw new Error(
    `all upstreams failed for ${dep}: ${errors.map((e) => JSON.stringify(e)).join('; ')}`,
  );
}

async function getDeals(dep: Departure, force = false): Promise<CacheEntry> {
  const now = Date.now();
  const cached = cache.get(dep);
  if (!force && cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  const ac = new AbortController();
  // Outer watchdog: 8s per upstream * 2 upstreams + buffer = 18s, but clamp at 16s
  const overallTimer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS * 2);
  try {
    const { body, mtime, source } = await fetchFromAnyUpstream(dep, ac.signal);
    const entry: CacheEntry = { body, fetchedAt: now, source, upstreamMtime: mtime };
    cache.set(dep, entry);
    return entry;
  } catch (err) {
    console.warn(`[api/deals] all upstreams failed for ${dep}, falling back to static:`, err);
    const body = await readStaticFallback(dep);
    const entry: CacheEntry = {
      body,
      fetchedAt: now - (CACHE_TTL_MS / 2), // expire halfway
      source: 'static-fallback',
      upstreamMtime: null,
    };
    cache.set(dep, entry);
    return entry;
  } finally {
    clearTimeout(overallTimer);
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
