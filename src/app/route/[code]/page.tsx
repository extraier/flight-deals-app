import { FlightDealCard } from '@/components/FlightDealCard';
import allDatesHkg from '@/data/all_dates.json';
import allDatesSzx from '@/data/all_dates_szx.json';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { FlightDeal } from '@/types/flight';

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ dep?: string }>;
}

// Hermes 2026-07-01: route page used to read ONLY the bundled static JSON,
// which is stale by hours. Now it first fetches live data from /api/deals
// (same upstream chain as the deals page — Tailscale Funnel → CDN → static
// fallback). The static JSON is kept as the last-resort fallback so the
// page still renders something if every upstream fails.
async function fetchDealsLive(dep: 'HKG' | 'SZX'): Promise<FlightDeal[] | null> {
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_BASE_URL || '';
  // Server-side fetch from the in-project API route. Cache 60s per dep
  // so multiple route clicks within the same minute don't hammer upstream.
  const url = `${base}/api/deals?dep=${dep}`;
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = await res.json();
    const results = (json.results || []) as FlightDeal[];
    // Drop rows that violate the FlightDeal contract (`price` required).
    // /api/deals occasionally emits partial rows when the scanner export is
    // mid-flight; those would crash FlightDealCard's `.price.toLocaleString()`.
    return results.filter(d => typeof d.price === 'number' && !!d.destination?.code);
  } catch {
    return null;
  }
}

export default async function RoutePage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const { dep } = await searchParams;
  const departure = (dep === 'SZX' ? 'SZX' : 'HKG') as 'HKG' | 'SZX';
  // Hermes 2026-07-01: uppercase the URL code before lookup. The case-
  // insensitive middleware may have lowercased the path (e.g. /route/BKK
  // → /route/bkk) before this handler runs. Codes in the data are always
  // uppercase (BKK, ICN, JFK etc), so normalizing the input here restores
  // the correct lookup.
  const normalizedCode = (code || '').toUpperCase();

  // Hermes 2026-07-01: try live data first, fall back to bundled JSON.
  let deals: FlightDeal[] = [];
  const live = await fetchDealsLive(departure);
  if (live && live.length > 0) {
    deals = live;
  } else {
    const allData = departure === 'HKG' ? allDatesHkg : allDatesSzx;
    const results = (allData.results || []) as FlightDeal[];
    deals = results.filter(d => typeof d.price === 'number' && !!d.destination?.code);
  }
  const deal = deals.find(d => d.destination.code === normalizedCode);

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="mx-auto max-w-lg px-4">
        {/* Back Link */}
        <Link
          href={`/?dep=${departure}`}
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          返回 {departure === 'HKG' ? '香港國際機場' : '深圳寶安機場'}
        </Link>

        {/* Departure Badge */}
        <div className="mb-4">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            departure === 'SZX'
              ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
              : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400'
          }`}>
            🛫 {departure === 'HKG' ? '香港國際機場 (HKG)' : '深圳寶安機場 (SZX)'}
          </span>
        </div>

        {/* Flight Deal Card */}
        {deal ? (
          <FlightDealCard deal={deal} departure={departure} />
        ) : (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <p className="text-muted-foreground">
              {departure === 'SZX'
                ? '深圳航班資料掃描中...'
                : `找不到 ${normalizedCode} 的數據`}
            </p>
            <Link
              href={`/?dep=${departure}`}
              className="mt-4 inline-block text-sm text-sky-600 hover:text-sky-500"
            >
              ← 返回機票列表
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}