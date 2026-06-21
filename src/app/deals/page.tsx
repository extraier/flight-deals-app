'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import allDatesHkg from '@/data/all_dates.json';
import allDatesSzx from '@/data/all_dates_szx.json';

type Departure = 'HKG' | 'SZX';

interface Deal {
  route: string;
  destination: { name: string; code: string; region: string };
  price: number;
  currency?: string;           // optional: not always present in scanner JSON
  badge?: { carryOn?: boolean; cheapDays?: number };
  typicalPrice?: number;
  cheapestDates: Array<{
    day: number; month: number; year: number;
    price: number; stay: number | null;
    history?: Record<string, { price: number; diff: number; pct: number }>;
    flight?: { airline?: string; flight_no?: string; dep_time?: string } | null;
  }>;
  totalDestinations?: number;
}

interface DropRow {
  route: string;
  destCode: string;
  destName: string;
  region: string;
  departure: Departure;
  oldPrice: number;        // yesterday's lowest
  newPrice: number;        // today's lowest
  dropAmount: number;      // oldPrice - newPrice (positive = drop)
  dropPct: number;         // round((oldPrice - newPrice) / oldPrice * 100)
  cheapestDate: { day: number; month: number; year: number; stay: number | null; airline?: string; dep_time?: string };
  typicalPrice?: number;
  discountVsTypical?: number; // pct off the typical price (informational)
}

// Extract a single "best drop" per destination — based on the cheapest
// cheapestDates[0] entry, comparing today's price to yesterday's lowest.
function buildDropList(deals: Deal[], departure: Departure): DropRow[] {
  const rows: DropRow[] = [];
  for (const d of deals) {
    const cd = d.cheapestDates?.[0];
    if (!cd) continue;
    const h1d = cd.history?.['1d'];
    if (!h1d) continue;                        // no yesterday baseline
    const oldPrice = h1d.price;
    const newPrice = cd.price;
    if (oldPrice <= 0 || newPrice <= 0) continue;
    const dropAmount = oldPrice - newPrice;    // > 0 means price dropped
    if (dropAmount <= 0) continue;             // we only show drops
    const dropPct = Math.round((dropAmount / oldPrice) * 100);
    const f = cd.flight || undefined;
    const typical = d.typicalPrice || undefined;
    const discountVsTypical = typical && typical > 0
      ? Math.round(((typical - newPrice) / typical) * 100)
      : undefined;
    rows.push({
      route: d.route,
      destCode: d.destination.code,
      destName: d.destination.name,
      region: d.destination.region,
      departure,
      oldPrice, newPrice, dropAmount, dropPct,
      cheapestDate: {
        day: cd.day, month: cd.month, year: cd.year,
        stay: cd.stay ?? null,
        airline: f?.airline, dep_time: f?.dep_time,
      },
      typicalPrice: typical,
      discountVsTypical,
    });
  }
  return rows;
}

function heat(pct: number): { emoji: string; label: string; cls: string } {
  if (pct >= 20) return { emoji: '🔥🔥🔥', label: '勁劈', cls: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40' };
  if (pct >= 10) return { emoji: '🔥🔥',   label: '大劈', cls: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/40' };
  return                  { emoji: '🔥',     label: '劈價', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40' };
}

const regionColors: Record<string, string> = {
  '東亞': 'bg-sky-500/10 text-sky-600 border-sky-500/30',
  '東南亞': 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  '中國': 'bg-red-500/10 text-red-600 border-red-500/30',
  '大洋洲': 'bg-cyan-500/10 text-cyan-600 border-cyan-500/30',
  '北美洲': 'bg-orange-500/10 text-orange-600 border-orange-500/30',
  '南美洲': 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  '歐洲': 'bg-violet-500/10 text-violet-600 border-violet-500/30',
  '南亞': 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  '中東': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  '非洲': 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
  '香港': 'bg-pink-500/10 text-pink-600 border-pink-500/30',
  '其他': 'bg-slate-500/10 text-slate-600 border-slate-500/30',
};

export default function DealsPage() {
  const [departure, setDeparture] = useState<Departure>('HKG');

  // Process both files once
  const hkgRows = useMemo(() => buildDropList((allDatesHkg.results || []) as Deal[], 'HKG'), []);
  const szxRows = useMemo(() => buildDropList((allDatesSzx.results || []) as Deal[], 'SZX'), []);

  const rows = departure === 'HKG' ? hkgRows : szxRows;

  const szxEmpty = szxRows.length === 0;

  const renderedRows = useMemo(() => {
    return [...rows].sort((a, b) => b.dropPct - a.dropPct);
  }, [rows]);

  // Stats
  const stats = useMemo(() => {
    if (renderedRows.length === 0) return null;
    const totalSaved = renderedRows.reduce((s, r) => s + r.dropAmount, 0);
    const biggest = renderedRows[0];
    const avg = renderedRows.reduce((s, r) => s + r.dropPct, 0) / renderedRows.length;
    return { totalSaved, biggest, avg: Math.round(avg) };
  }, [renderedRows]);

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="mx-auto max-w-5xl px-4">
        {/* Header */}
        <div className="mb-4 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">🔥 今日劈價</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            對比昨日最低價 · 顯示實際跌價嘅航線 · 按跌幅 % 排序
          </p>
        </div>

        {/* Departure tabs */}
        <div className="mb-6 flex justify-center">
          <div className="inline-flex rounded-lg border border-border bg-card p-1 gap-1">
            {(['HKG', 'SZX'] as Departure[]).map((d) => (
              <button
                key={d}
                onClick={() => setDeparture(d)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  departure === d
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {d === 'HKG' ? '🛫 香港 HKG' : '🛫 深圳 SZX'}
              </button>
            ))}
          </div>
        </div>

        {/* Empty state for SZX */}
        {departure === 'SZX' && szxEmpty ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <div className="text-4xl mb-3">⏳</div>
              <p className="text-lg font-medium text-foreground">SZX 劈價數據準備中</p>
              <p className="text-sm text-muted-foreground mt-2">
                SZX 掃描器已開始記錄歷史價格，下一次掃描後即可顯示劈價列表。<br />
                預計 1-2 日內可見數據。
              </p>
              <div className="mt-4 text-xs text-muted-foreground">
                💡 HKG 已有 {hkgRows.length} 個劈價航線
              </div>
            </CardContent>
          </Card>
        ) : renderedRows.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <div className="text-4xl mb-3">📈</div>
              <p className="text-lg font-medium text-foreground">今日無劈價</p>
              <p className="text-sm text-muted-foreground mt-2">
                所有航線價格都比昨日高或持平，無可顯示嘅劈價。
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Stats summary */}
            {stats && (
              <div className="mb-5 grid grid-cols-3 gap-3 sm:gap-4">
                <div className="rounded-lg border border-border bg-card p-3 text-center">
                  <div className="text-2xl font-bold text-emerald-600">{renderedRows.length}</div>
                  <div className="text-xs text-muted-foreground">劈價航線</div>
                </div>
                <div className="rounded-lg border border-border bg-card p-3 text-center">
                  <div className="text-2xl font-bold text-emerald-600">${stats.totalSaved.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">總共慳到</div>
                </div>
                <div className="rounded-lg border border-border bg-card p-3 text-center">
                  <div className="text-2xl font-bold text-orange-500">-{stats.avg}%</div>
                  <div className="text-xs text-muted-foreground">平均跌幅</div>
                </div>
              </div>
            )}

            {/* Drop list */}
            <div className="space-y-3">
              {renderedRows.map((r, idx) => {
                const h = heat(r.dropPct);
                const dateLabel = `${r.cheapestDate.year}年${r.cheapestDate.month}月${r.cheapestDate.day}日`;
                return (
                  <Link
                    key={`${r.departure}-${r.route}-${idx}`}
                    href={`/route/${r.destCode}?dep=${r.departure}`}
                    className="block group"
                  >
                    <Card className="transition-all hover:border-orange-500/50 hover:shadow-lg hover:shadow-orange-500/10">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          {/* Heat icon */}
                          <div className="shrink-0 text-2xl select-none pt-1" aria-label={h.label}>
                            {h.emoji}
                          </div>

                          {/* Main info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-lg font-bold text-foreground">{r.destName}</span>
                                  <Badge variant="outline" className={`text-xs ${regionColors[r.region] || regionColors['其他']}`}>
                                    {r.region}
                                  </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  <span className="mr-2">{r.route}</span>
                                  {r.cheapestDate.airline && (
                                    <span className="mr-2">✈️ {String(r.cheapestDate.airline).replace(/^_/, '')}</span>
                                  )}
                                  {r.cheapestDate.dep_time && (
                                    <span className="mr-2">🕒 {r.cheapestDate.dep_time}</span>
                                  )}
                                  {r.cheapestDate.stay && (
                                    <span>📅 {r.cheapestDate.stay} 日</span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  最平出發：{dateLabel}
                                </div>
                              </div>

                              {/* Price comparison */}
                              <div className="text-right shrink-0">
                                <div className="flex items-baseline gap-2 justify-end">
                                  <span className="text-xs text-muted-foreground line-through">
                                    ${r.oldPrice.toLocaleString()}
                                  </span>
                                  <span className="text-xs text-muted-foreground">→</span>
                                  <span className="text-2xl font-bold text-emerald-600">
                                    ${r.newPrice.toLocaleString()}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center justify-end gap-1.5">
                                  <Badge className={`text-xs font-bold ${h.cls}`}>
                                    -{r.dropPct}% · -{r.dropAmount.toLocaleString()}
                                  </Badge>
                                </div>
                                {r.discountVsTypical !== undefined && r.discountVsTypical > 0 && (
                                  <div className="text-[10px] text-muted-foreground mt-1">
                                    比一般價平 {r.discountVsTypical}%
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>

            {/* Footer note */}
            <p className="mt-6 text-center text-xs text-muted-foreground">
              * 「昨日最低價」來自系統自動記錄嘅歷史掃描數據，每 6 小時更新一次
            </p>
          </>
        )}
      </div>
    </div>
  );
}
