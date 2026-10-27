/**
 * Flight deals API route.
 *
 * Hermes 2026-10-27: SELF-HOSTED ON NAS. This app now runs as a Next.js
 * standalone server on the UGREEN NAS (192.168.50.35), fronted by
 * Tailscale Funnel. Vercel is no longer in the request path.
 *
 * Why the data source changed:
 *   The old topology was: NAS → fli-data-server.py:9877 → Tailscale Funnel
 *   (public HTTPS) → Vercel /api/deals → page.
 *   That is a hairpin: the NAS called its own public URL over the internet
 *   to read files sitting on its own disk. It worked, but it meant the
 *   app's core data path depended on a public DNS name + Tailscale's DERP
 *   relay being reachable, and it burned latency on every request.
 *
 *   Now the app runs ON the NAS, so it reads the JSON files directly from
 *   /volume1/flight-scanner/. No network hop, no Funnel dependency, and
 *   the app keeps working even if Tailscale's relay has a bad day.
 *
 * Data files (all on the NAS, written by the scanner + fli-data-server):
 *   /volume1/flight-scanner/all_dates.json        HKG
 *   /volume1/flight-scanner/all_dates_szx.json    SZX
 *   /volume1/flight-scanner/all_dates_uo.json     UO drops
 *   /volume1/flight-scanner/all_dates_cx.json     CX drops
 *   /volume1/flight-scanner/all_dates_cooldown.json
 *
 * Augmentation note: the OLD pipeline had fli-data-server.py bundle
 * uoDrops + cxDrops + cooldown INTO the all_dates.json response. The Vercel
 * route then fetched the sidecar files separately as a safety net.
 * On the NAS we now do the same thing in-process: read all_dates.json,
 * then merge in the UO/CX sidecars and the cooldown. This keeps the exact
 * response shape the /deals page expects.
 *
 * Cache: 20s in-memory with request coalescing — concurrent visitors within
 * the 20s window share a single file read. The deals page polls every 20s,
 * so users always see fresh data without manual cache bypasses.
 *
 * Security: F-07 — the public `force=1` cache bypass is REMOVED. It was
 * abused by the deals page's 20s poll to fire two upstream requests per
 * tick per visitor. Manual refresh is not needed because the in-memory
 * cache TTL matches the page poll interval.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CACHE_TTL_MS = 20_000; // 20 seconds — matches deals page poll interval

type Departure = 'HKG' | 'SZX';

// Hermes 2026-10-27: the app self-hosts on the NAS, so the scanner output
// lives on the same disk. FLI_DATA_DIR can override for local dev (point
// it at ../../src/data) but defaults to the NAS path.
const FLI_DATA_DIR =
  process.env.FLI_DATA_DIR || '/volume1/flight-scanner';

type DealRecord = Record<string, unknown>;

interface CacheEntry {
  body: unknown;
  fetchedAt: number;
  source: 'nas-disk' | 'static-fallback';
  upstreamMtime: number | null;
}

const cache = new Map<Departure, CacheEntry>();

// Request coalescing: while a read is in flight, additional callers
// receive the same Promise. Prevents thundering-herd disk reads when
// the cache expires and N visitors hit /api/deals simultaneously.
const inflight = new Map<Departure, Promise<CacheEntry>>();

const NAS_FILE: Record<Departure, string> = {
  HKG: 'all_dates.json',
  SZX: 'all_dates_szx.json',
};

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

async function statMtime(fp: string): Promise<number | null> {
  try {
    const st = await fs.stat(fp);
    return Math.floor(st.mtimeMs);
  } catch {
    return null;
  }
}

/**
 * Read one JSON file from the NAS scanner output dir.
 * Returns null if the file is missing or unparseable.
 */
async function readJsonFile(name: string): Promise<unknown | null> {
  const fp = path.join(FLI_DATA_DIR, name);
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Merge the UO/CX airline sidecars + the cooldown into the main HKG
 * payload, mirroring what fli-data-server.py did on the NAS before.
 * Only HKG gets sidecars (SZX has no airline-specific exports).
 */
async function augmentWithSidecars(payload: unknown): Promise<unknown> {
  if (!payload || typeof payload !== 'object') return payload;
  const obj = payload as Record<string, unknown>;

  for (const [name, airline] of [
    ['all_dates_uo.json', 'UO'],
    ['all_dates_cx.json', 'CX'],
  ] as const) {
    const sidecar = await readJsonFile(name);
    if (!sidecar || typeof sidecar !== 'object') continue;
    const results = (sidecar as { results?: unknown }).results;
    if (!Array.isArray(results)) continue;
    obj[`${airline.toLowerCase()}Drops`] = results.map((row) => ({
      ...(row as DealRecord),
      airline,
    }));
  }

  const cd = await readJsonFile('all_dates_cooldown.json');
  if (cd && typeof cd === 'object') {
    obj.cooldown = cd;
  }

  return obj;
}

async function loadFromNas(dep: Departure): Promise<CacheEntry> {
  const filename = NAS_FILE[dep];
  const fp = path.join(FLI_DATA_DIR, filename);

  let body = await readJsonFile(filename);
  let source: CacheEntry['source'] = 'nas-disk';

  if (body === null) {
    // Scanner file missing — fall back to the bundled JSON shipped with
    // the build. The page will still render, just with older data.
    body = await readStaticFallback(dep);
    source = 'static-fallback';
  } else if (dep === 'HKG') {
    body = await augmentWithSidecars(body);
  }

  const mtime = await statMtime(fp);
  return { body, fetchedAt: Date.now(), source, upstreamMtime: mtime };
}

async function getEntry(dep: Departure): Promise<CacheEntry> {
  const hit = cache.get(dep);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit;
  }

  const pending = inflight.get(dep);
  if (pending) return pending;

  const p = loadFromNas(dep)
    .then((entry) => {
      cache.set(dep, entry);
      return entry;
    })
    .finally(() => {
      inflight.delete(dep);
    });

  inflight.set(dep, p);
  return p;
}

// Hermes 2026-10-19: uoDrops / cxDrops in SidecarData use a permissive
// record type because the upstream JSON can have arbitrary fields.
// The `airline` field is the only typed discriminator; we set it
// when projecting.
type AirlineDrop = Record<string, unknown> & { airline: 'UO' | 'CX' };

interface SidecarData {
  // Hermes 2026-10-14: shape changed. Previously only UO was
  // fetched; CX was missing. The funnel allowlist now exposes both files
  // (see fli-data-server.py ALLOW_FILES), so we fetch them in parallel to
  // halve wall-time vs two sequential awaits. SZX has no airline-specific
  // exports, so we only do this for HKG; fetchSidecar is HKG-only and SZX
  // falls through with empty arrays.
  uoDrops: AirlineDrop[];
  cxDrops: AirlineDrop[];
  cooldown: Record<string, {
    amount: number | null;
    pct: number | null;
    price: number | null;
    ts: string | null;
  }>;
}

async function fetchSidecar(): Promise<SidecarData> {
  const empty: SidecarData = { uoDrops: [], cxDrops: [], cooldown: {} };

  const [uo, cx, cd] = await Promise.all([
    readJsonFile('all_dates_uo.json'),
    readJsonFile('all_dates_cx.json'),
    readJsonFile('all_dates_cooldown.json'),
  ]);

  const projectAirlineDrops = (rows: unknown, airline: 'UO' | 'CX') =>
    Array.isArray(rows)
      ? (rows as DealRecord[]).map((r) => ({ ...r, airline }))
      : [];

  empty.uoDrops = projectAirlineDrops(
    (uo as { results?: unknown } | null)?.results,
    'UO',
  );
  empty.cxDrops = projectAirlineDrops(
    (cx as { results?: unknown } | null)?.results,
    'CX',
  );
  if (cd && typeof cd === 'object') {
    empty.cooldown = cd as SidecarData['cooldown'];
  }
  return empty;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const depParam = (url.searchParams.get('dep') || 'HKG').toUpperCase();
  const dep: Departure = depParam === 'SZX' ? 'SZX' : 'HKG';

  const entry = await getEntry(dep);
  const sidecar = dep === 'HKG' ? await fetchSidecar() : {
    uoDrops: [],
    cxDrops: [],
    cooldown: {},
  };

  const body = entry.body as Record<string, unknown> | null;
  const merged =
    body && typeof body === 'object'
      ? {
          ...body,
          uoDrops: sidecar.uoDrops,
          cxDrops: sidecar.cxDrops,
          cooldown: sidecar.cooldown,
        }
      : body;

  return new Response(JSON.stringify(merged), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Data-Source': entry.source,
      'X-File-Mtime': String(entry.upstreamMtime ?? 0),
    },
  });
}
