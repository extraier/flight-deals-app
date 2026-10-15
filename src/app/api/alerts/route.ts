// Hermes 2026-10-15: structured alerts endpoint.
// Returns alerts from the SQL-based alerts database (drop_alerts.db),
// exported to src/data/drop_alerts.json. The bot's
// scripts/export_alerts_to_json.py runs after every detection and
// refreshes this JSON. The page's /api/alerts reads from this file,
// applies a 24h GC, and serves filtered results.
//
// 24h GC: only alerts with expires_at > now are returned. This matches
// the bot's COOLDOWN_WINDOW — once an alert has been around for 24h,
// neither the bot nor the page surfaces it as "持續跌價".

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL_MS = 5_000;  // 5s — matches bot's export cadence

let cached: { body: unknown; fetchedAt: number } | null = null;

async function loadAlerts() {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.body;
  }
  const fp = path.join(process.cwd(), 'src', 'data', 'drop_alerts.json');
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    const body = JSON.parse(raw);
    cached = { body, fetchedAt: Date.now() };
    return body;
  } catch {
    return { generated: new Date().toISOString(), alerts: [] };
  }
}

function filterExpired(alerts: any[]): any[] {
  const nowMs = Date.now();
  return alerts.filter((a) => {
    if (!a.expires_at) return true;
    const expMs = Date.parse(a.expires_at);
    return !isNaN(expMs) && expMs > nowMs;
  });
}

export async function GET(req: NextRequest) {
  const body: any = await loadAlerts();
  const url = new URL(req.url);
  const airport = url.searchParams.get('airport') || '';
  const airline = url.searchParams.get('airline') || '';

  // 24h GC at the API layer
  let alerts = filterExpired(body.alerts || []);
  if (airport) alerts = alerts.filter((a: any) => a.airport === airport);
  if (airline) alerts = alerts.filter((a: any) => a.airline === airline);

  return NextResponse.json({
    generated: body.generated,
    alerts,
    count: alerts.length,
  });
}
