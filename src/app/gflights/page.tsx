'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock, RefreshCw, Mail } from 'lucide-react';
import { translateDateRange, translateAirlines, translateCity, translateStops, translateDuration, correctedDepartureIso, departureIsPast, formatDepartureZh } from '@/lib/gflights_i18n';

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
type SortBy = 'alert' | 'discount';

function alertDateObj(d: GfDeal): Date | null {
  if (typeof d.alert_unix_ms === 'number' && d.alert_unix_ms > 0) {
    return new Date(d.alert_unix_ms);
  }
  if (d.alert_date) {
    try {
      const parsed = new Date(d.alert_date);
      if (!isNaN(parsed.getTime())) return parsed;
    } catch { /* fall through */ }
  }
  if (d.first_seen) {
    try {
      const parsed = new Date(d.first_seen);
      if (!isNaN(parsed.getTime())) return parsed;
    } catch { /* fall through */ }
  }
  return null;
}

/** HKT calendar day key YYYY-MM-DD — matches the date users see on the page. */
function alertDayKey(d: GfDeal): string {
  const dt = alertDateObj(d);
  if (!dt) return 'unknown';
  return dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
}

function formatDayHeader(dayKey: string): string {
  if (dayKey === 'unknown') return '日期不明';
  // Noon HKT so the calendar day is unambiguous.
  const dt = new Date(`${dayKey}T12:00:00+08:00`);
  if (isNaN(dt.getTime())) return dayKey;
  return dt.toLocaleDateString('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

export default function GFlightsPage() {
  const [deals, setDeals] = useState<GfDeal[]>([]);
  const [generated, setGenerated] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  // Hermes 2026-11-08: dates always newest-first. Within a date section,
  // 'alert' sorts by latest email (alert_unix_ms desc); 'discount' by save_pct.
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
    Promise.resolve().then(() => {
      load();
    });
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

  const visibleDeals = deals.flatMap((d) => {
    const dep = correctedDepartureIso(d);
    if (dep && departureIsPast(dep)) return [];
    return [{ ...d, dep_date: dep || d.dep_date }];
  });
  const origins = Array.from(new Set(visibleDeals.map((d) => d.origin))).sort();
  const filtered = originFilter === 'all'
    ? visibleDeals
    : visibleDeals.filter((d) => d.origin === originFilter);

  // Group by alert calendar day (HKT), not destination.
  const byDay = new Map<string, GfDeal[]>();
  for (const d of filtered) {
    const key = alertDayKey(d);
    const list = byDay.get(key) || [];
    list.push(d);
    byDay.set(key, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => {
      if (sortBy === 'discount') {
        const sa = typeof a.save_pct === 'number' ? a.save_pct : -1;
        const sb = typeof b.save_pct === 'number' ? b.save_pct : -1;
        if (sb !== sa) return sb - sa;
        const pa = a.price_hkd ?? Infinity;
        const pb = b.price_hkd ?? Infinity;
        if (pa !== pb) return pa - pb;
      } else {
        // Default: newest Gmail alert first within the day.
        const ta = typeof a.alert_unix_ms === 'number' ? a.alert_unix_ms : 0;
        const tb = typeof b.alert_unix_ms === 'number' ? b.alert_unix_ms : 0;
        if (tb !== ta) return tb - ta;
        // Same email: cheaper first, then destination name.
        const pa = a.price_hkd ?? Infinity;
        const pb = b.price_hkd ?? Infinity;
        if (pa !== pb) return pa - pb;
      }
      return (a.destination_name || '').localeCompare(b.destination_name || '');
    });
  }

  const dayList = Array.from(byDay.entries())
    .map(([day, list]) => ({ day, deals: list }))
    .sort((a, b) => {
      if (a.day === 'unknown') return 1;
      if (b.day === 'unknown') return -1;
      return b.day.localeCompare(a.day);
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

  const viewHref = (d: GfDeal) =>
    d.view_link
    || `https://www.google.com/travel/flights?hl=zh-HK&curr=HKD&q=${encodeURIComponent(`${d.origin} to ${d.destination_name}`)}`;

  return (
    <main className="min-h-screen bg-gradient-to-br from-violet-50/30 via-white to-orange-50/30">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-8">

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

        <div className="mb-6 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground inline-flex items-center gap-2">
            <span aria-hidden className="text-3xl sm:text-4xl">📧</span>
            <span>Google Flights 推介</span>
          </h1>
          {(() => {
            const latestAlertMs = visibleDeals.reduce((max, d) => {
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
                  : '過去 30 日由 Gmail 自動解析嘅航班推介'}
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

        <div className="mb-4 flex justify-center">
          <div className="inline-flex rounded-lg border border-border bg-card p-1 gap-1">
            <button
              onClick={() => setSortBy('alert')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all inline-flex items-center gap-1 ${
                sortBy === 'alert'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title="同日內最新推介電郵優先"
            >
              <Clock className="h-3 w-3" />
              最新電郵優先
            </button>
            <button
              onClick={() => setSortBy('discount')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all inline-flex items-center gap-1 ${
                sortBy === 'discount'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title="同日內折扣最多優先"
            >
              🏷️ 折扣最多優先
            </button>
          </div>
        </div>

        {fetchError && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            載入失敗：{fetchError}
          </div>
        )}

        {loading && visibleDeals.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            載入中...
          </div>
        )}

        {!loading && visibleDeals.length === 0 && !fetchError && (
          <div className="rounded-xl border border-dashed border-violet-200 bg-violet-50/30 p-8 text-center">
            <div className="text-4xl mb-2" aria-hidden>📭</div>
            <p className="text-sm font-medium text-foreground">暫時無新嘅 Google Flights 推介</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Gmail poller 暫時未有新嘅 noreply-travel@google.com 郵件
            </p>
          </div>
        )}

        {/* Deal groups: one section per alert date (HKT), newest first */}
        <div className="space-y-6">
          {dayList.map(({ day, deals: list }) => (
            <section key={day} aria-labelledby={`gflights-day-${day}`}>
              <div className="sticky top-0 z-10 -mx-1 px-1 py-2 mb-2 bg-gradient-to-b from-white via-white/95 to-white/80 backdrop-blur-sm">
                <h2
                  id={`gflights-day-${day}`}
                  className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2 flex-wrap"
                >
                  <Mail className="h-4 w-4 text-violet-600" />
                  <span>{formatDayHeader(day)}</span>
                  <span className="text-xs font-medium text-muted-foreground bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-full">
                    {list.length} 個推介
                  </span>
                </h2>
              </div>

              <div className="space-y-3">
                {list.map((d) => {
                  const low = d.price_range?.[0];
                  const high = d.price_range?.[1];
                  const savingPct = (low != null && high != null && d.price_hkd && low > 0)
                    ? Math.max(0, Math.round((1 - d.price_hkd / ((low + high) / 2)) * 100))
                    : null;
                  const alertT = formatAlertTime(d.alert_date, d.alert_unix_ms);
                  return (
                    <article
                      key={d.id}
                      className="rounded-xl border border-violet-200/60 bg-white shadow-sm overflow-hidden"
                    >
                      <a
                        href={viewHref(d)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-4 sm:p-5 hover:bg-violet-50/40 transition-colors group"
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-2xl" aria-hidden>✈️</span>
                              <h3 className="text-lg sm:text-xl font-bold text-foreground break-words">
                                {translateCity(d.origin)} → {translateCity(d.destination_name)}
                              </h3>
                            </div>
                            <div className="mt-1.5 text-sm text-muted-foreground leading-snug">
                              <div className="font-medium text-foreground">
                                {formatDepartureZh(d.dep_date)}
                                {d.date_range ? ` · ${translateDateRange(d.date_range)}` : ''}
                              </div>
                              <div className="mt-0.5 text-[12px] text-muted-foreground/90">
                                {[
                                  d.airlines && translateAirlines(d.airlines),
                                  d.stops != null && translateStops(d.stops),
                                  d.duration && translateDuration(d.duration),
                                ].filter(Boolean).map((seg, i) => (
                                  <span key={i} className="whitespace-nowrap">
                                    {i > 0 && ' · '}
                                    {seg}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <p className="mt-1.5 text-[10px] text-muted-foreground/70 flex items-center gap-1">
                              <span aria-hidden>🧳</span>
                              行李政策請向航空公司查詢
                            </p>
                            {d.trip_label && (
                              <p className="mt-1 text-[11px] text-muted-foreground/80 break-words">
                                {d.trip_label}
                                {d.params && <span className="ml-1.5">· {d.params}</span>}
                              </p>
                            )}
                            {alertT && (
                              <p className="mt-1 text-[11px] text-muted-foreground/80 flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                Google 推介：{alertT}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-2xl sm:text-3xl font-bold text-violet-700 whitespace-nowrap">
                              {formatPrice(d.price_hkd)}
                            </div>
                            {d.save_pct != null && d.save_pct > 0 && (
                              <span className="mt-1 inline-block text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded whitespace-nowrap">
                                SAVE {d.save_pct}%
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
                            <span className="ml-auto text-violet-600 group-hover:translate-x-0.5 transition-transform whitespace-nowrap">查看詳情 →</span>
                          </div>
                        )}
                      </a>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {visibleDeals.length > 0 && (
          <p className="mt-6 text-center text-[10px] text-muted-foreground">
            按推介電郵日期分組 · 同日內最新電郵優先 · 點擊卡片到 Google Flights · 數據由 Gmail noreply-travel@google.com 自動解析
          </p>
        )}
      </div>
    </main>
  );
}
