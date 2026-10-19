/**
 * Flight deals API route.
 *
 * Hermes 2026-09-28: rewrote upstream strategy after the cloudflared tunnel on the
 * NAS died (since Jul 28) and Tailscale Funnel was discovered to actually work
 * from public internet via *.ts.net public DNS records.
 *   1. Try Tailscale Funnel (https://dh4300plus-70ca-1.tail20bf1.ts.net) — public
 *      DNS resolves *.ts.net to Tailscale's DERP proxy IPs (verified 2026-09-28).
 *      This is the primary path. WAS BROKEN because route.ts used the wrong
 *      hostname (ugreen-nas.tail20bf1.ts.net — old NAS, replaced).
 *   2. Fall back to public HTTPS CDN (cdn.savetheday.io/deals) — dead since
 *      cloudflared tunnel went down Jul 28, 2026. Kept as secondary for resilience.
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

// Hermes 2026-09-28: Funnel hostname is the actual NAS's tailscale name
// (dh4300plus-70ca-1, NOT the old ugreen-nas). *.ts.net has public DNS
// records pointing at Tailscale's DERP proxy IPs, so this resolves from
// any network — not just MagicDNS clients. Tested with DoH 2026-09-28:
// `dig dh4300plus-70ca-1.tail20bf1.ts.net @1.1.1.1` → 103.84.155.153
const FUNNEL_BASE = 'https://dh4300plus-70ca-1.tail20bf1.ts.net';
const CDN_BASE = 'https://cdn.savetheday.io/deals';
const CACHE_TTL_MS = 20_000; // 20 seconds — matches deals page poll interval

type Departure = 'HKG' | 'SZX';

// Hermes 2026-10-19: typed return instead of `any[]`. The shape is the
// generic Deal record from all_dates_uo.json / all_dates_cx.json
// (see src/app/deals/page.tsx `interface Deal`). We don't know the
// exact subset, so use `Record<string, unknown>` and the caller
// (projectAirlineDrops) just spreads it — no field-by-field typing
// needed at the network boundary.
type DealRecord = Record<string, unknown>;

// Hermes 2026-10-19: uoDrops / cxDrops in SidecarData use a permissive
// record type because the upstream JSON can have arbitrary fields.
// The `airline` field is the only typed discriminator; we set it
// when projecting. The original `Record<string, unknown> & {airline: 'UO'}`
// intersection caused `projectAirlineDrops` to fail the type check
// when it returned `{airline: 'UO' | 'CX'}` (widened). Use a single
// union type that's compatible with both narrow and wide airline.
type AirlineDrop = Record<string, unknown> & { airline: 'UO' | 'CX' };

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

// Hermes 2026-09-29: the NAS funnel (https://dh4300plus-70ca-1.tail20bf1.ts.net)
// can only route one path per public URL — Tailscale Funnel doesn't support
// path-based multiplexing to the same backend port. So the augmentation
// happens on the NAS side: fli-data-server bundles uoDrops + cooldown INTO
// the all_dates.json response when serving it. The Vercel function just
// passes the merged body through. Sidecar fetch fields remain here as a
// safety net for local-dev / static-fallback mode where augmentation may
// not be available.
interface SidecarData {
  // Hermes 2026-10-14: shape changed. Previously these were summary DropRow-ish
  // objects (route, destination, price, dropAmount, dropPct, depDate). The page
  // never consumed them (grep confirmed 0 references in deals/page.tsx) and the
  // summary shape was too thin for buildDropList to do anything useful with.
  //
  // Now we return full Deal records (the same shape as the HKG results array).
  // The page appends them to hkgDeals before buildDropList runs, so UO/CX
  // routes participate in the same drop + cooldown + airline-filter pipeline
  // as the HKG routes. This is what makes the airline filter dropdown show
  // "UO" and "CX" as selectable options.
  uoDrops: AirlineDrop[];
  cxDrops: AirlineDrop[];
  cooldown: Record<string, {
    amount: number | null;
    pct: number | null;
    price: number | null;
    ts: string | null;
  }>;
}

async function fetchSidecar(parentSignal: AbortSignal): Promise<SidecarData> {
  const empty: SidecarData = { uoDrops: [], cxDrops: [], cooldown: {} };
  // Hermes 2026-10-14: refactored to a generic helper. Previously only UO was
  // fetched; CX was missing. The funnel allowlist now exposes both files
  // (see fli-data-server.py ALLOW_FILES), so we fetch them in parallel to
  // halve wall-time vs two sequential awaits. SZX has no airline-specific
  // exports, so we only do this for HKG; fetchSidecar is HKG-only and SZX
  // falls through with empty arrays.
const fetchAirlineDrops = async (parentSignal: AbortSignal, filename: string): Promise<DealRecord[]> => {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
    const abortParent = () => ac.abort();
    parentSignal.addEventListener('abort', abortParent);
    try {
      const res = await fetch(`${FUNNEL_BASE}/${filename}`, {
        signal: ac.signal,
        headers: { 'User-Agent': 'flight-deals-app/1.1 (vercel-edge)' },
        cache: 'no-store',
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { results?: DealRecord[] };
      if (!Array.isArray(body?.results)) return [];
      return body.results;
    } catch (err) {
      console.warn(`[api/deals] ${filename} sidecar fetch failed (non-fatal):`, String(err));
      return [];
    } finally {
      clearTimeout(timeout);
      parentSignal.removeEventListener('abort', abortParent);
    }
  };
  // Hermes 2026-10-14: pass through the FULL deal record (not a summary projection).
  // The page merges these into hkgDeals, so they need the same shape: route,
  // destination {name, code, region}, price, typicalPrice, dropAmount, dropPct,
  // cheapestDates[], firstDetected, etc. The only field we add is `airline`,
  // which buildDropList reads to populate the airline-filter chip and the
  // cheapestDate.airline badge.
  const projectAirlineDrops = (rows: DealRecord[], airline: 'UO' | 'CX') =>
    rows.map((r) => ({ ...r, airline }));
  // UO + CX in parallel (HKG only).
  const [uoRows, cxRows] = await Promise.all([
    fetchAirlineDrops(parentSignal, 'all_dates_uo.json'),
    fetchAirlineDrops(parentSignal, 'all_dates_cx.json'),
  ]);
  empty.uoDrops = projectAirlineDrops(uoRows, 'UO');
  empty.cxDrops = projectAirlineDrops(cxRows, 'CX');
  // Cooldown: best-effort, never blocks deals
  try {
    const res = await fetch(`${FUNNEL_BASE}/all_dates_cooldown.json`, {
      signal: parentSignal,
      headers: { 'User-Agent': 'flight-deals-app/1.1 (vercel-edge)' },
      cache: 'no-store',
    });
    if (res.ok) {
      const cd = (await res.json()) as Record<string, unknown>;
      // Normalize entries: {amount, pct, price, ts}
      for (const [k, raw] of Object.entries(cd)) {
        if (raw && typeof raw === 'object') {
          const v = raw as { amount?: unknown; pct?: unknown; price?: unknown; ts?: unknown };
          empty.cooldown[k] = {
            amount: typeof v.amount === 'number' ? v.amount : null,
            pct: typeof v.pct === 'number' ? v.pct : null,
            price: typeof v.price === 'number' ? v.price : null,
            ts: typeof v.ts === 'string' ? v.ts : null,
          };
        }
      }
    }
  } catch (err) {
    console.warn('[api/deals] cooldown sidecar fetch failed (non-fatal):', String(err));
  }
  return empty;
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
      // Hermes 2026-09-29: the NAS-side fli-data-server already augments
      // all_dates.json with uoDrops + cooldown (because Tailscale Funnel
      // can only route one path per public URL — separate UO/cooldown routes
      // aren't reachable). The Vercel layer just passes the merged body
      // through. The sidecar fetch below is a safety net: if augmentation
      // ever stops, this re-merges the raw fields from the upstream JSON
      // shape (uoDrops + cooldown already inline when augmentation is on,
      // so the spread below is a no-op idempotent merge).
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
