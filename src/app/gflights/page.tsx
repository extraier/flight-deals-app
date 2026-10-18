'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock, RefreshCw, Mail } from 'lucide-react';
import { translateDateRange, translateAirlines, translateCity, translateStops, translateDuration } from '@/lib/gflights_i18n';

interface GfDeal {
  id: string;
  source: 'google_flights';
  origin: string;
  destination_name: string;
  dep_date: string;
  date_range: string;
  price_hkd: number;
  save_pct: number | null;
  airlines: string | null;
  stops: number | null;
  duration: string | null;
  view_link: string | null;
  trip_label: string | null;
  params: string | null;
  price_range: [number, number] | null;
  min_price: number;
  first_seen: string;
  prices_updated: string | null;
  // Hermes 2026-10-18: when Gmail delivered the digest. Same value for
  // every deal in the same email. alert_unix_ms is the canonical form
  // for sort/filter; alert_date is the ISO string with timezone, used
  // for the display.
  alert_date?: string | null;
  alert_unix_ms?: number | null;
}

type OriginFilter = 'all' | 'Hong Kong';
type SortBy = 'alert' | 'price';

export default function GFlightsPage() {
  const [deals, setDeals] = useState<GfDeal[]>([]);
  const [generated, setGenerated] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  // Hermes 2026-10-18: 'alert' (default) means most recently emailed
  // destinations surface first; 'price' sorts by cheapest first.
  const [sortBy, setSortBy] = useState<SortBy>('alert');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/gflights', { cache: 'no-store' });
      if (!res.ok) throw new Error(`/api/gflights ${res.status}`);
      const json = await res.json();
      setDeals((json.deals || []) as GfDeal[]);
      setGenerated(json.generated || '');
      setLastRefresh(new Date());
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // 5-min interval — gflights digest is fed by the Gmail poller, which
    // runs every 30 min. Polling the JSON faster than the upstream is
    // wasteful.
    const t = setInterval(() => load(true), 5 * 60_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') load(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const origins = Array.from(new Set(deals.map((d) => d.origin))).sort();
  const filtered = originFilter === 'all'
    ? deals
    : deals.filter((d) => d.origin === originFilter);

  // Group by destination so the cheapest card per route shows first,
  // and duplicate destinations surface as a "more options" list.
  const byDest = new Map<string, GfDeal[]>();
  for (const d of filtered) {
    const list = byDest.get(d.destination_name) || [];
    list.push(d);
    byDest.set(d.destination_name, list);
  }
  // Sort each group's deals by price asc.
  for (const list of byDest.values()) {
    list.sort((a, b) => (a.price_hkd ?? Infinity) - (b.price_hkd ?? Infinity));
  }

  // Hermes 2026-10-18: build the destination list and capture the most
  // recent alert time per destination (across all the deals in that
  // group). The toggle below lets the user pick between two orderings:
  //   - "alert"  (default): most recently emailed routes first, so a
  //     fresh London alert outranks a week-old Taipei deal
  //   - "price": cheapest first, the old behaviour
  const destEntries = Array.from(byDest.entries()).map(([dest, list]) => {
    const latestAlert = list.reduce((m, d) => {
      const v = typeof d.alert_unix_ms === 'number' ? d.alert_unix_ms : 0;
      return v > m ? v : m;
    }, 0);
    return { dest, deals: list, cheapest: list[0], latestAlert };
  });
  const destList = destEntries.sort((a, b) => {
    if (sortBy === 'alert') {
      // Most recent alert first; break ties by cheapest price.
      if (b.latestAlert !== a.latestAlert) return b.latestAlert - a.latestAlert;
      return (a.cheapest.price_hkd ?? Infinity) - (b.cheapest.price_hkd ?? Infinity);
    }
    return (a.cheapest.price_hkd ?? Infinity) - (b.cheapest.price_hkd ?? Infinity);
  });

  const formatPrice = (n: number) => `HK$${(n ?? 0).toLocaleString()}`;
  const formatTimestamp = (iso: string) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('zh-HK', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  };
  // Hermes 2026-10-18: format when Google sent the digest email. Shows
  // the local HKT date + time so the user can tell which Gmail alert
  // a deal came from (e.g. "10/17 20:00" vs "10/11 16:52"). For an
  // ISO string with timezone, this is the HKT time. For Unix ms
  // fallback, also HKT. The result drops the year since the user is
  // reading this in real time.
  const formatAlertTime = (iso?: string | null, unixMs?: number | null) => {
    let d: Date | null = null;
    if (iso) {
      try { d = new Date(iso); } catch { d = null; }
    }
    if (!d && typeof unixMs === 'number' && unixMs > 0) {
      d = new Date(unixMs);
    }
    if (!d || isNaN(d.getTime())) return '';
    return d.toLocaleString('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-violet-50/30 via-white to-orange-50/30">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-8">

        {/* Top bar: back link + refresh */}
        <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            返回主頁
          </Link>
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="重新整理"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {lastRefresh ? `更新於 ${lastRefresh.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' })}` : '重新整理'}
          </button>
        </div>

        {/* Hero header */}
        <div className="mb-6 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground inline-flex items-center gap-2">
            <span aria-hidden className="text-3xl sm:text-4xl">📧</span>
            <span>Google Flights 推介</span>
          </h1>
          {(() => {
            // Hermes 2026-10-18: show the latest alert time across all
            // deals so the user knows the freshness at a glance. The
            // JSON's "generated" is when the poller ran (can be 30 min
            // after the latest email), but alert_unix_ms is when Google
            // actually sent the digest. We use the latter.
            const latestAlertMs = deals.reduce((max, d) => {
              const m = d.alert_unix_ms;
              return typeof m === 'number' && m > max ? m : max;
            }, 0);
            const latestAlert = latestAlertMs
              ? formatAlertTime(new Date(latestAlertMs).toISOString(), latestAlertMs)
              : '';
            return (
              <p className="mt-2 text-sm text-muted-foreground">
                {latestAlert
                  ? `最新一封 Google 推介電郵：${latestAlert}`
                  : '過去 24 小時由 Gmail 自動解析嘅航班推介'}
              </p>
            );
          })()}
          {generated && (
            <p className="mt-1 text-xs text-muted-foreground/80 inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              數據更新：{formatTimestamp(generated)}
            </p>
          )}
        </div>

        {/* Origin filter (only if there are >1 origins) */}
        {origins.length > 1 && (
          <div className="mb-4 flex justify-center">
            <div className="inline-flex rounded-lg border border-border bg-card p-1 gap-1">
              <button
                onClick={() => setOriginFilter('all')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  originFilter === 'all'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                全部
              </button>
              {origins.map((o) => (
                <button
                  key={o}
                  onClick={() => setOriginFilter(o as OriginFilter)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    originFilter === o
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  ✈️ {translateCity(o)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Hermes 2026-10-18: sort-by toggle. Default = 'alert' (most
            recently emailed first), so a fresh London alert outranks
            a week-old Taipei deal. 'price' is the old behaviour. */}
        <div className="mb-4 flex justify-center">
          <div className="inline-flex rounded-lg border border-border bg-card p-1 gap-1">
            <button
              onClick={() => setSortBy('alert')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all inline-flex items-center gap-1 ${
                sortBy === 'alert'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title="最新推介優先"
            >
              <Clock className="h-3 w-3" />
              最新推介優先
            </button>
            <button
              onClick={() => setSortBy('price')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all inline-flex items-center gap-1 ${
                sortBy === 'price'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title="最平優先"
            >
              💰 最平優先
            </button>
          </div>
        </div>

        {/* Status banners */}
        {fetchError && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            載入失敗：{fetchError}
          </div>
        )}

        {loading && deals.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            載入中...
          </div>
        )}

        {!loading && deals.length === 0 && !fetchError && (
          <div className="rounded-xl border border-dashed border-violet-200 bg-violet-50/30 p-8 text-center">
            <div className="text-4xl mb-2" aria-hidden>📭</div>
            <p className="text-sm font-medium text-foreground">暫時無新嘅 Google Flights 推介</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Gmail poller 暫時未有新嘅 noreply-travel@google.com 郵件
            </p>
          </div>
        )}

        {/* Deal groups: one card per destination showing cheapest, then
            a "更多出發日期" expander if there are alternate date/deal combos */}
        <div className="space-y-3">
          {destList.map(({ dest, deals: list }) => {
            const main = list[0];
            const alts = list.slice(1);
            const low = main.price_range?.[0];
            const high = main.price_range?.[1];
            const savingPct = (low != null && high != null && main.price_hkd && low > 0)
              ? Math.max(0, Math.round((1 - main.price_hkd / ((low + high) / 2)) * 100))
              : null;
            return (
              <article
                key={dest}
                className="rounded-xl border border-violet-200/60 bg-white shadow-sm overflow-hidden"
              >
                {/* Main cheapest card */}
                <a
                  href={main.view_link || `https://www.google.com/travel/flights?q=Flights%20to%20${encodeURIComponent(main.destination_name)}%20from%20${encodeURIComponent(main.origin)}%20on%20${main.dep_date}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-4 sm:p-5 hover:bg-violet-50/40 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-2xl" aria-hidden>✈️</span>
                        <h2 className="text-lg sm:text-xl font-bold text-foreground">
                          {translateCity(main.origin)} → {translateCity(main.destination_name)}
                        </h2>
                      </div>
                      <div className="mt-1.5 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {translateDateRange(main.date_range)}
                        </span>
                        {main.airlines && <span className="ml-2">· {translateAirlines(main.airlines)}</span>}
                        {main.stops != null && <span className="ml-2">· {translateStops(main.stops)}</span>}
                        {main.duration && <span className="ml-2">· {translateDuration(main.duration)}</span>}
                      </div>
                      {main.trip_label && (
                        <p className="mt-1 text-[11px] text-muted-foreground/80">
                          {main.trip_label}
                          {main.params && <span className="ml-1.5">· {main.params}</span>}
                        </p>
                      )}
                      {/* Hermes 2026-10-18: when Google sent the Gmail digest
                          that this deal was parsed from. Sits below the
                          trip_label/params line so it doesn't compete with
                          the date/route line for attention. */}
                      {(() => {
                        const t = formatAlertTime(main.alert_date, main.alert_unix_ms);
                        if (!t) return null;
                        return (
                          <p className="mt-1 text-[11px] text-muted-foreground/80 inline-flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            Google 推介：{t}
                          </p>
                        );
                      })()}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-2xl sm:text-3xl font-bold text-violet-700">
                        {formatPrice(main.price_hkd)}
                      </div>
                      {main.save_pct != null && main.save_pct > 0 && (
                        <span className="mt-1 inline-block text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                          SAVE {main.save_pct}%
                        </span>
                      )}
                    </div>
                  </div>
                  {low && high && (
                    <div className="mt-3 pt-3 border-t border-violet-100 text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>過去 12 個月範圍：{formatPrice(low)} – {formatPrice(high)}</span>
                      {savingPct != null && savingPct > 0 && (
                        <span className="text-emerald-700 font-medium">· 低於平均 {savingPct}%</span>
                      )}
                      <span className="ml-auto text-violet-600 group-hover:translate-x-0.5 transition-transform">查看詳情 →</span>
                    </div>
                  )}
                </a>

                {/* Alternates: same destination, different dates/prices */}
                {alts.length > 0 && (
                  <div className="border-t border-violet-100 bg-violet-50/20">
                    <div className="px-4 sm:px-5 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                      更多出發日期 ({alts.length})
                    </div>
                    <div className="divide-y divide-violet-100/60">
                      {alts.map((d) => (
                        <a
                          key={d.id}
                          href={d.view_link || `https://www.google.com/travel/flights?q=Flights%20to%20${encodeURIComponent(d.destination_name)}%20from%20${encodeURIComponent(d.origin)}%20on%20${d.dep_date}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-2 px-4 sm:px-5 py-2.5 text-sm hover:bg-violet-50/40 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-foreground font-medium truncate">
                              {translateDateRange(d.date_range)}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {d.airlines && <span>{translateAirlines(d.airlines)}</span>}
                              {d.stops != null && <span className="ml-2">{translateStops(d.stops)}</span>}
                              {d.duration && <span className="ml-2">{translateDuration(d.duration)}</span>}
                            </div>
                            {/* Hermes 2026-10-18: each alternate can come from
                                a different Gmail digest (Google sends separate
                                emails for different time windows). Show its
                                own alert time so the user knows the
                                freshness. */}
                            {(() => {
                              const t = formatAlertTime(d.alert_date, d.alert_unix_ms);
                              if (!t) return null;
                              return (
                                <div className="text-[10px] text-muted-foreground/70 inline-flex items-center gap-1 mt-0.5">
                                  <Mail className="h-2.5 w-2.5" />
                                  {t}
                                </div>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {d.save_pct != null && d.save_pct > 0 && (
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                                SAVE {d.save_pct}%
                              </span>
                            )}
                            <span className="font-bold text-violet-700">{formatPrice(d.price_hkd)}</span>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {/* Footer attribution */}
        {deals.length > 0 && (
          <p className="mt-6 text-center text-[10px] text-muted-foreground">
            點擊卡片到 Google Flights 搜尋 · 數據由 Gmail noreply-travel@google.com 自動解析
          </p>
        )}
      </div>
    </main>
  );
}
