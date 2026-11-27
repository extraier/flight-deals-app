/**
 * Extreme 開口機票 from the latest ITA Matrix daily report.
 *
 * Same in-process read as /api/deals: the file lives on the NAS disk
 * (FLI_DATA_DIR, default /volume1/flight-scanner), not in the git bundle.
 *   ita-matrix/daily/latest.json
 *
 * Only rows whose package (ita.price + positioning.price) is more than
 * 70% below hkg_direct_baseline.price are returned. A missing report is
 * an empty list — that is a normal state, not an error.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { selectExtremeOpenJawDeals } from '@/lib/openJaw';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CACHE_TTL_MS = 20_000;

function reportPath(): string {
  const dir = process.env.FLI_DATA_DIR || '/volume1/flight-scanner';
  return path.join(dir, 'ita-matrix', 'daily', 'latest.json');
}

interface CacheEntry {
  body: unknown;
  fetchedAt: number;
  mtimeMs: number;
  source: 'nas-disk' | 'missing';
}

let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry> | null = null;

async function loadReport(): Promise<CacheEntry> {
  const fp = reportPath();
  let mtimeMs = 0;
  try {
    const st = await fs.stat(fp);
    mtimeMs = st.mtimeMs;
  } catch {
    mtimeMs = 0;
  }

  if (
    cache
    && cache.mtimeMs === mtimeMs
    && Date.now() - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return cache;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const raw = await fs.readFile(fp, 'utf-8');
      const entry: CacheEntry = {
        body: JSON.parse(raw),
        fetchedAt: Date.now(),
        mtimeMs,
        source: 'nas-disk',
      };
      cache = entry;
      return entry;
    } catch {
      const entry: CacheEntry = {
        body: null,
        fetchedAt: Date.now(),
        mtimeMs,
        source: 'missing',
      };
      cache = entry;
      return entry;
    }
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

export async function GET() {
  const entry = await loadReport();
  const view = selectExtremeOpenJawDeals(entry.body);
  return Response.json(
    {
      ...view,
      source: entry.source,
      count: view.deals.length,
    },
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}
