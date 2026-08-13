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
 * Cache: 20s in-memory with request coalescing — concurrent visitors within
 * the 20s window share a single upstream fetch. The deals page polls every
 * 20s, so users always see fresh data without manual cache bypasses.
 *
 * Security: F-07 — the public `force=1` cache bypass is REMOVED. It was
 * abused by the deals page's 20s poll to fire two upstream requests per
 * tick per visitor (HKG + SZX), multiplying Vercel + upstream traffic by
 * the number of concurrent visitors. Manual refresh is no longer needed
 * because the in-memory cache TTL matches the page poll interval.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FUNNEL_BASE = 'https://ugreen-nas.tail20bf1.ts.net';
const CDN_BASE = 'https://cdn.savetheday.io/deals';
const CACHE_TTL_MS = 20_000; // 20 seconds — matches deals page poll interval

type Departure = 'HKG' | 'SZX';

interface CacheEntry {
  body: unknown;
  fetchedAt: number;
  source: 'funnel' | 'cdn' | 'static-fallback';
  upstreamMtime: number | null;
}

const cache = new Map<Departure, CacheEntry>();

// Request coalescing: while a fetch is in flight, additional callers
// receive the same Promise. Prevents thundering-herd upstream loads when
// the cache expires and N visitors hit /api/deals simultaneously.
const inflight = new Map<Departure, Promise<CacheEntry>>();

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
  throw new Error(
    `all upstreams failed for ${dep}: ${errors.map((e) => JSON.stringify(e)).join('; ')}`,
  );
}

const UPSTREAM_TIMEOUT_MS = 8_000;

async function getDeals(dep: Departure): Promise<CacheEntry> {
  const now = Date.now();
  const cached = cache.get(dep);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  // Coalesce: if a fetch is already in flight for this dep, await it
  // instead of starting a duplicate upstream call.
  const existing = inflight.get(dep);
  if (existing) return existing;

  const promise = (async (): Promise<CacheEntry> => {
    const ac = new AbortController();
    const overallTimer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS * 2);
    try {
      const { body, mtime, source } = await fetchFromAnyUpstream(dep, ac.signal);
      const entry: CacheEntry = { body, fetchedAt: Date.now(), source, upstreamMtime: mtime };
      cache.set(dep, entry);
      return entry;
    } catch (err) {
      console.warn(`[api/deals] all upstreams failed for ${dep}, falling back to static:`, err);
      const body = await readStaticFallback(dep);
      const entry: CacheEntry = {
        body,
        // Mark static fallback as half-expired so we retry upstream sooner
        fetchedAt: Date.now() - (CACHE_TTL_MS / 2),
        source: 'static-fallback',
        upstreamMtime: null,
      };
      cache.set(dep, entry);
      return entry;
    } finally {
      clearTimeout(overallTimer);
      inflight.delete(dep);
    }
  })();

  inflight.set(dep, promise);
  return promise;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const depParam = (searchParams.get('dep') || 'HKG').toUpperCase() as Departure;
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
    // F-15: do NOT leak the internal Tailscale Funnel hostname in the
    // public health response. Keep cache state only.
    return Response.json(
      { ok: true, cache: cacheOut },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (depParam !== 'HKG' && depParam !== 'SZX') {
    return Response.json({ error: `invalid departure: ${depParam}` }, { status: 400 });
  }

  try {
    const entry = await getDeals(depParam);
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
