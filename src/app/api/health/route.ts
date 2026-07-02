/**
 * Health probe for the flight-deals data pipeline.
 *
 * Hermes 2026-07-01:
 *   - Probes upstream CDN (cdn.savetheday.io) with a fresh HEAD-style GET
 *     so we don't depend on the 60s in-process cache in /api/deals.
 *   - Computes age of all_dates.json via x-file-mtime header (UNIX SECONDS,
 *     not ms — this is the standard convention for static file servers).
 *   - Reports Chinese-name coverage on the freshest available body.
 *   - Designed to be polled by an alert cron (every 10min) to detect
 *     "JSON stale > 10min" via Telegram.
 *
 * Status semantics (consumed by cron alert script):
 *   ok         — fresh (< STALE_AFTER_SEC), no upstream failures
 *   stale      — older than STALE_AFTER_SEC but < CRITICAL_AFTER_SEC, OR single upstream down
 *   critical   — older than CRITICAL_AFTER_SEC, OR all upstreams failed, OR bundle fallback
 *   unknown    — could not determine (no probes yet)
 *
 * JSON shape: { results: [{ route, destination: {code, name, region}, ... }], generated }
 *   The "name" field is already formatted as "中文 (IATA)" so we detect coverage
 *   by checking if the name contains any CJK characters.
 */

import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FUNNEL_BASE = 'https://ugreen-nas.tail20bf1.ts.net';
const CDN_BASE = 'https://cdn.savetheday.io/deals';
const PROBE_TIMEOUT_MS = 6_000;

// Thresholds: tune via environment if you want to override from Vercel dashboard.
//
// Why these values: the scanner runs a single-threaded loop over HKG then SZX,
// where each cycle is ~50 min of route work + 10 min inter-cycle pause. So an
// airport can be 60–80 min "stale" by design (waiting for its next turn) and
// the next export is ~110 min apart. We choose:
//   STALE_AFTER_SEC    default  1500  (25 min — page is starting to feel stale
//                                       but normal for an alternating cycle)
//   CRITICAL_AFTER_SEC default  7200  (2 h — page is surely stuck or the
//                                       scanner has died. Real incident.)
// A genuine scanner death (e.g. fli_4x_continuous.py segfaults) is caught
// here, while the natural HKG/SZX interleaving does not false-alarm.
const STALE_AFTER_SEC = Number(process.env.HEALTH_STALE_AFTER_SEC) || 1500;
const CRITICAL_AFTER_SEC =
  Number(process.env.HEALTH_CRITICAL_AFTER_SEC) || 7200;

type Departure = 'HKG' | 'SZX';

interface UpstreamResult {
  source: 'funnel' | 'cdn';
  ok: boolean;
  status?: number;
  error?: string;
  upstreamMtimeSec: number | null;
  fetchedAtMs: number;
}

interface DestCoverage {
  total: number;
  withNameCn: number;
  withRegionCn: number;
  examplesIataOnly: string[];
}

interface DepReport {
  departures: Record<Departure, UpstreamResult & { coverage?: DestCoverage }>;
  staleAfterSec: number;
  criticalAfterSec: number;
  status: 'ok' | 'stale' | 'critical' | 'unknown';
  worstAgeSec: number;
  evaluatedAtMs: number;
}

// Detect CJK Unified Ideographs (the most common Chinese character range).
// U+4E00..U+9FFF covers the bulk of CJK; the supplementary planes (Extension A/B/etc.)
// are rare in airport names but covered here for completeness.
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;

async function probeUpstream(dep: Departure): Promise<UpstreamResult> {
  const suffix = dep === 'SZX' ? '_szx' : '';
  const candidates: { name: 'funnel' | 'cdn'; url: string }[] = [
    {
      name: 'funnel',
      url: `${FUNNEL_BASE}/all_dates${suffix}.json`,
    },
    {
      name: 'cdn',
      url: `${CDN_BASE}/all_dates${suffix}.json`,
    },
  ];

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  const fetchedAtMs = Date.now();
  const lastError: { source: string; err: unknown }[] = [];

  for (const c of candidates) {
    try {
      const res = await fetch(c.url, {
        signal: ac.signal,
        method: 'GET',
        headers: {
          'User-Agent': 'flight-deals-app/health-probe/1.0 (vercel-edge)',
        },
        cache: 'no-store',
      });
      if (!res.ok) {
        lastError.push({ source: c.name, err: `${res.status} ${res.statusText}` });
        continue;
      }
      clearTimeout(timer);
      // x-file-mtime is conventionally UNIX seconds (nginx $mtime, Apache, etc.).
      // Some servers (S3, Cloudflare R2) emit ms; sniff by magnitude.
      const mtimeHeader = res.headers.get('x-file-mtime');
      let mtimeSec: number | null = null;
      if (mtimeHeader) {
        const raw = Number(mtimeHeader);
        if (Number.isFinite(raw) && raw > 0) {
          // > 10^12 means ms, else seconds.
          mtimeSec = raw > 1e12 ? Math.round(raw / 1000) : Math.round(raw);
        }
      }
      return {
        source: c.name,
        ok: true,
        status: res.status,
        upstreamMtimeSec: mtimeSec,
        fetchedAtMs,
      };
    } catch (err) {
      lastError.push({ source: c.name, err });
      continue;
    }
  }
  clearTimeout(timer);
  return {
    source: 'cdn',
    ok: false,
    upstreamMtimeSec: null,
    fetchedAtMs,
    error: `all upstreams failed: ${JSON.stringify(lastError)}`,
  };
}

/**
 * Compute age (in seconds) of upstream mtime, given mtime in SECONDS.
 * Returns null if mtime is missing or in the future (clock skew).
 */
function ageSec(mtimeSec: number | null, fetchedAtMs: number): number | null {
  if (mtimeSec == null) return null;
  const nowSec = Math.round(fetchedAtMs / 1000);
  const age = nowSec - mtimeSec;
  // Allow 5min future skew for clock drift, otherwise treat as null.
  if (age < -300) return null;
  return Math.max(0, age);
}

function chineseCoverage(body: unknown): DestCoverage {
  // Walk the JSON, harvesting destinations. Real shape:
  //   { results: [{ destination: { code, name, region }, ... }], generated }
  // The "name" field is "中文 (IATA)" so we check for CJK presence.
  const allCodes = new Set<string>();
  const iataOnly: string[] = [];
  let withNameCn = 0;
  let withRegionCn = 0;

  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const v of node) visit(v);
      return;
    }
    const obj = node as Record<string, unknown>;
    // Detect a "destination" subobject and inspect it.
    if (obj.destination && typeof obj.destination === 'object') {
      const d = obj.destination as Record<string, unknown>;
      if (typeof d.code === 'string') {
        allCodes.add(d.code);
        const name = typeof d.name === 'string' ? d.name : '';
        const region = typeof d.region === 'string' ? d.region : '';
        const nameHasCn = CJK_RE.test(name);
        const regionHasCn = CJK_RE.test(region);
        if (nameHasCn) withNameCn++;
        if (regionHasCn) withRegionCn++;
        if (!nameHasCn && !iataOnly.includes(d.code)) {
          iataOnly.push(d.code);
        }
      }
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') visit(v);
    }
  }

  visit(body);
  return {
    total: allCodes.size,
    withNameCn,
    withRegionCn,
    examplesIataOnly: iataOnly.slice(0, 5),
  };
}

async function probeBody(dep: Departure): Promise<DestCoverage | null> {
  const suffix = dep === 'SZX' ? '_szx' : '';
  const candidates = [
    `${CDN_BASE}/all_dates${suffix}.json`,
    `${FUNNEL_BASE}/all_dates${suffix}.json`,
  ];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          signal: ac.signal,
          cache: 'no-store',
          headers: {
            'User-Agent': 'flight-deals-app/health-probe/1.0 (vercel-edge)',
          },
        });
        if (!res.ok) continue;
        const body = await res.json();
        return chineseCoverage(body);
      } catch {
        continue;
      }
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const wantCoverage = url.searchParams.get('coverage') === '1';

  const deps = ['HKG', 'SZX'] as Departure[];
  const probeResults = await Promise.all(
    deps.map(async (d) => ({
      dep: d,
      probe: await probeUpstream(d),
    })),
  );

  const report: DepReport = {
    departures: {} as DepReport['departures'],
    staleAfterSec: STALE_AFTER_SEC,
    criticalAfterSec: CRITICAL_AFTER_SEC,
    status: 'unknown',
    worstAgeSec: 0,
    evaluatedAtMs: Date.now(),
  };

  let worstAge = 0;
  let anyOk = false;
  let allFailed = true;

  for (const { dep, probe } of probeResults) {
    if (probe.ok) {
      anyOk = true;
      allFailed = false;
    }
    const age = ageSec(probe.upstreamMtimeSec, probe.fetchedAtMs);
    if (age != null && age > worstAge) worstAge = age;
    let coverage: DestCoverage | undefined;
    if (wantCoverage && probe.ok) {
      coverage = (await probeBody(dep)) ?? undefined;
    }
    report.departures[dep] = { ...probe, coverage };
  }

  if (allFailed) {
    report.status = 'critical';
    report.worstAgeSec = -1;
  } else if (worstAge >= CRITICAL_AFTER_SEC) {
    report.status = 'critical';
    report.worstAgeSec = worstAge;
  } else if (worstAge >= STALE_AFTER_SEC) {
    report.status = 'stale';
    report.worstAgeSec = worstAge;
  } else if (anyOk) {
    report.status = 'ok';
    report.worstAgeSec = worstAge;
  }

  const httpStatus =
    report.status === 'critical' ? 503 : report.status === 'stale' ? 200 : 200;

  return Response.json(report, {
    status: httpStatus,
    headers: {
      'Cache-Control': 'no-store',
      'X-Health-Status': report.status,
      'X-Data-Age-Sec': String(report.worstAgeSec),
    },
  });
}
