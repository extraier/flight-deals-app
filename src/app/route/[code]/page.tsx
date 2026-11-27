import { FlightDealCard } from '@/components/FlightDealCard';
import { PriceCalendar } from '@/components/PriceCalendar';
import allDatesHkg from '@/data/all_dates.json';
import allDatesSzx from '@/data/all_dates_szx.json';
import Link from 'next/link';
import { headers } from 'next/headers';
import { ArrowLeft } from 'lucide-react';
import type { FlightDeal } from '@/types/flight';
import { loadHkgStayCalendar } from '@/lib/calendarSource';
import { fixCityName } from '@/lib/cityNames';

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ dep?: string; from?: string }>;
}

// Hermes 2026-07-01: route page used to read ONLY the bundled static JSON,
// which is stale by hours. Now it first fetches live data from /api/deals
// (same upstream chain as the deals page — Tailscale Funnel → CDN → static
// fallback). The static JSON is kept as the last-resort fallback so the
// page still renders something if every upstream fails.
//
// Hermes 2026-10-27: self-hosted on the NAS. The app now serves itself, so
// a server-side fetch to its own /api/deals must use an absolute URL that
// resolves on this host. VERCEL_URL is gone (no more Vercel). We build the
// base from the request headers when available, falling back to localhost.
async function fetchDealsLive(
  dep: 'HKG' | 'SZX',
  reqHeaders?: Headers,
): Promise<FlightDeal[] | null> {
  const host = reqHeaders?.get('x-forwarded-host') || reqHeaders?.get('host');
  const proto = reqHeaders?.get('x-forwarded-proto') || 'http';
  const base = host
    ? `${proto}://${host}`
    : process.env.NEXT_PUBLIC_BASE_URL || 'http://127.0.0.1:3000';
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
  const { dep, from } = await searchParams;
  const departure = (dep === 'SZX' ? 'SZX' : 'HKG') as 'HKG' | 'SZX';
  // Hermes 2026-08-14: `from` query param tells us where the user came from.
  // `from=room:<roomId>` → back to couple room
  // `from=wishlist` → back to /match/wishlist
  // default → back to airport selector
  const backHref = from?.startsWith('room:')
    ? `/match/room/${from.slice('room:'.length)}`
    : from === 'wishlist'
    ? '/match/wishlist'
    : `/?dep=${departure}`;
  const backLabel = from?.startsWith('room:')
    ? '返回情侶房間'
    : from === 'wishlist'
    ? '返回心願清單'
    : `返回 ${departure === 'HKG' ? '香港國際機場' : '深圳寶安機場'}`;
  // Hermes 2026-07-01: uppercase the URL code before lookup. The case-
  // insensitive middleware may have lowercased the path (e.g. /route/BKK
  // → /route/bkk) before this handler runs. Codes in the data are always
  // uppercase (BKK, ICN, JFK etc), so normalizing the input here restores
  // the correct lookup.
  const normalizedCode = (code || '').toUpperCase();

  // Hermes 2026-07-01: try live data first, fall back to bundled JSON.
  let deals: FlightDeal[] = [];
  // Hermes 2026-10-27: pass request headers so the self-hosted server can
  // build an absolute URL for its own /api/deals (no VERCEL_URL anymore).
  const reqHeaders = await headers();
  const live = await fetchDealsLive(departure, reqHeaders);
  if (live && live.length > 0) {
    deals = live;
  } else {
    const allData = departure === 'HKG' ? allDatesHkg : allDatesSzx;
    const results = (allData.results || []) as FlightDeal[];
    deals = results.filter(d => typeof d.price === 'number' && !!d.destination?.code);
  }
  const deal = deals.find(d => d.destination.code === normalizedCode);
  const calendar = departure === 'HKG' ? await loadHkgStayCalendar(normalizedCode) : null;
  const showHeatmap = calendar?.heatmap === true;

  return (
    <div className="min-h-screen bg-background py-12">
      <div className={`mx-auto px-4 ${showHeatmap ? 'max-w-5xl' : 'max-w-lg'}`}>
        {/* Back Link — Hermes 2026-08-14: smart target based on ?from= param */}
        <Link
          href={backHref}
          className="mb-8 inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white font-medium transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
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

        {departure === 'SZX' && (
          <p className="mb-4 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            深圳出發的日期未夠密，暫不顯示價格日曆。
          </p>
        )}
        {departure === 'HKG' && !showHeatmap && (
          <p className="mb-4 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            完整 7 日來回日曆需要日期庫（fli_calendar.db 或 hkg_stay7_calendar.json）。未接到全日資料，所以不顯示稀疏日曆。
          </p>
        )}
        {calendar?.heatmap && (
          <PriceCalendar
            data={calendar}
            title={deal ? fixCityName(deal.destination.name) : calendar.name}
          />
        )}

        {/* Flight Deal Card */}
        {deal ? (
          <FlightDealCard deal={deal} departure={departure} showDateGrid={!showHeatmap} />
        ) : (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <p className="text-muted-foreground">
              {departure === 'SZX'
                ? '深圳航班資料載入中...'
                : `找不到 ${normalizedCode} 的數據`}
            </p>
            <Link
              href={backHref}
              className="mt-4 inline-block text-sm text-sky-600 hover:text-sky-500"
            >
              ← {backLabel}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}