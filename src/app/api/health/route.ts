/**
 * Health probe for the flight-deals data pipeline.
 *
 * Hermes 2026-07-01:
 *   - Probes upstream CDN (cdn.savetheday.io) with a fresh HEAD-style GET
 *     so we don't depend on the 60s in-process cache in /api/deals.
 *   - Computes age of all_dates.json via x-file-mtime header (UNIX ms).
 *   - Reports Chinese-name coverage on the freshest available body.
 *   - Designed to be polled by an alert cron (every 10min) to detect
 *     "JSON stale > 10min" via Telegram.
 *
 * Status semantics (consumed by cron alert script):
 *   ok         — fresh (< STALE_AFTER_SEC), no upstream failures
 *   stale      — older than STALE_AFTER_SEC but < CRITICAL_AFTER_SEC, OR single upstream down
 *   critical   — older than CRITICAL_AFTER_SEC, OR all upstreams failed, OR bundle fallback
 *   unknown    — could not determine (no probes yet)
 */

import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FUNNEL_BASE = 'https://ugreen-nas.tail20bf1.ts.net';
const CDN_BASE = 'https://cdn.savetheday.io/deals';
const PROBE_TIMEOUT_MS = 6_000;

// Thresholds: tune via environment if you want to override from Vercel dashboard.
//   STALE_AFTER_SEC    default  600   (10min — typical alert threshold)
//   CRITICAL_AFTER_SEC default  1800  (30min — page is surely stuck)
const STALE_AFTER_SEC = Number(process.env.HEALTH_STALE_AFTER_SEC) || 600;
const CRITICAL_AFTER_SEC =
  Number(process.env.HEALTH_CRITICAL_AFTER_SEC) || 1800;

type Departure = 'HKG' | 'SZX';

interface UpstreamResult {
  source: 'funnel' | 'cdn';
  ok: boolean;
  status?: number;
  error?: string;
  upstreamMtimeMs: number | null;
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
      clearTimeout(timer);
      if (!res.ok) {
        return {
          source: c.name,
          ok: false,
          status: res.status,
          upstreamMtimeMs: null,
          fetchedAtMs,
          error: `upstream returned ${res.status} ${res.statusText}`,
        };
      }
      const mtime = Number(res.headers.get('x-file-mtime') ?? 0) || null;
      return {
        source: c.name,
        ok: true,
        status: res.status,
        upstreamMtimeMs: mtime,
        fetchedAtMs,
      };
    } catch (err) {
      // Try the next candidate.
      continue;
    }
  }
  clearTimeout(timer);
  return {
    source: 'cdn',
    ok: false,
    upstreamMtimeMs: null,
    fetchedAtMs,
    error: 'all upstreams timed out or unreachable',
  };
}

function chineseCoverage(deals: unknown): DestCoverage {
  // The JSON shape from /api/deals is { generated, deals, ... }. Walk
  // everything and harvest IATA codes + name_cn / region_cn strings to
  // give the alert something concrete to flag ("HKT has 0 name_cn").
  const allCodes = new Set<string>();
  const iataOnly: string[] = [];

  function walk(node: unknown): { code?: string; nameCn?: unknown; regionCn?: unknown }[] {
    if (!node || typeof node !== 'object') return [];
    const obj = node as Record<string, unknown>;
    const out: { code?: string; nameCn?: unknown; regionCn?: unknown }[] = [];
    if (typeof obj.code === 'string') {
      out.push({
        code: obj.code,
        nameCn: obj.name_cn,
        regionCn: obj.region_cn,
      });
    }
    // Also handle IATA key variants: dest_iata, origin, dest, etc.
    for (const k of ['dest_iata', 'origin', 'dest']) {
      if (typeof obj[k] === 'string') {
        out.push({
          code: obj[k] as string,
          nameCn: obj.name_cn ?? obj.dest_name_cn,
          regionCn: obj.region_cn ?? obj.dest_region_cn,
        });
      }
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v) || (v && typeof v === 'object')) {
        out.push(...walk(v));
      }
    }
    return out;
  }

  const entries = walk(deals);
  let withNameCn = 0;
  let withRegionCn = 0;
  for (const e of entries) {
    if (!e.code) continue;
    allCodes.add(e.code);
    const hasName = typeof e.nameCn === 'string' && e.nameCn.trim() !== '';
    const hasRegion = typeof e.regionCn === 'string' && e.regionCn.trim() !== '';
    if (hasName) withNameCn++;
    if (hasRegion) withRegionCn++;
    if (!hasName && !iataOnly.includes(e.code)) {
      iataOnly.push(e.code);
    }
  }
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
    if (probe.ok && probe.upstreamMtimeMs) anyOk = true;
    if (!probe.ok) {
      // keep allFailed if no successes yet
    } else {
      allFailed = false;
    }
    if (probe.upstreamMtimeMs) {
      const ageSec = Math.max(0, Math.round((Date.now() - probe.upstreamMtimeMs) / 1000));
      if (ageSec > worstAge) worstAge = ageSec;
    }
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
