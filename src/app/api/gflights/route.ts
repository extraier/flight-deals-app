// Hermes 2026-10-17: Google Flights digest endpoint.
// Returns the parsed deals from gflights_digest.json (committed to git).
// 24h GC: filters out deals whose first_seen is older than 24h.

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL_MS = 5_000;

let cached: { body: unknown; fetchedAt: number } | null = null;

async function loadDigest() {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.body;
  }
  const fp = path.join(process.cwd(), 'src', 'data', 'gflights_digest.json');
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    const body = JSON.parse(raw);
    cached = { body, fetchedAt: Date.now() };
    return body;
  } catch {
    return { generated: new Date().toISOString(), source: 'gmail://noreply-travel@google.com', deals: [], count: 0 };
  }
}

function filterExpired(deals: any[]): any[] {
  const nowMs = Date.now();
  return deals.filter((d) => {
    if (!d.first_seen) return true;
    const firstMs = Date.parse(d.first_seen);
    return !isNaN(firstMs) && (nowMs - firstMs) < 24 * 60 * 60 * 1000;
  });
}

export async function GET(req: NextRequest) {
  const body: any = await loadDigest();
  const url = new URL(req.url);
  const origin = url.searchParams.get('origin') || '';
  const dest = url.searchParams.get('destination') || '';

  let deals = filterExpired(body.deals || []);
  if (origin) deals = deals.filter((d: any) => d.origin === origin);
  if (dest) deals = deals.filter((d: any) =>
    d.destination_name.toLowerCase().includes(dest.toLowerCase()));

  return NextResponse.json({
    generated: body.generated,
    source: body.source,
    deals,
    count: deals.length,
  });
}
