'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
// Static JSONs are kept as the build-time fallback only — the live data comes
// from /api/deals which fetches directly from the NAS via Tailscale Funnel.
// See src/app/api/deals/route.ts.
import staticHkg from '@/data/all_dates.json';
import staticSzx from '@/data/all_dates_szx.json';

type SortOption = 'price' | 'discount';
type FilterMode = 'region' | 'country';
type Departure = 'HKG' | 'SZX';

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

const regions = ['全部', '東亞', '東南亞', '中國', '大洋洲', '北美洲', '歐洲', '南亞', '中東', '非洲', '南美洲'];

const DEPARTURE_LABELS: Record<Departure, { label: string; subtitle: string }> = {
  HKG: { label: '香港國際機場', subtitle: '香港國際機場 ✈️ 最低機票' },
  SZX: { label: '深圳寶安機場', subtitle: '深圳寶安機場 ✈️ 最低機票' },
};

interface Deal {
  route: string;
  destination: { name: string; code: string; region: string };
  price: number;
  currency?: string;
  badge?: { carryOn?: boolean; cheapDays?: number };
  typicalPrice: number;
  cheapestDates: Array<{
    day: number; month: number; year: number;
    price: number; stay?: number | null;
    history?: Record<string, { price: number; diff: number; pct: number }>;
    flight?: unknown;
  }>;
  totalDestinations: number;
  totalDates?: number;
}

interface FlightData {
  results?: Deal[];
  generated?: string;
  source?: string;
  departure?: string;
}

type ComparePeriod = 'now' | '1d' | '4d' | '7d';
const COMPARE_LABELS: Record<ComparePeriod, string> = {
  now: '今日',
  '1d': '1日前',
  '4d': '4日前',
  '7d': '7日前',
};

const CITY_TO_COUNTRY: Record<string, string> = {
  TPE: '台灣', KHH: '台灣', RMQ: '台灣',
  NRT: '日本', NGO: '日本', KIX: '日本', FUK: '日本', CTS: '日本', OKA: '日本',
  ICN: '韓國', PUS: '韓國',
  PVG: '中國', PEK: '中國', CAN: '中國', SZX: '中國', CTU: '中國', XIY: '中國',
  BKK: '泰國', MNL: '菲律賓', SIN: '新加坡', KUL: '馬來西亞', HAN: '越南', SGN: '越南',
  CGK: '印尼', DPS: '印尼', RGN: '緬甸', PEN: '馬來西亞',
  BOM: '印度', DEL: '印度', CMB: '斯里蘭卡',
  DOH: '卡塔爾', DXB: '阿聯酋', CAI: '埃及',
  LHR: '英國', CDG: '法國', AMS: '荷蘭', BCN: '西班牙', MAD: '西班牙',
  FCO: '意大利', FRA: '德國',
  LAX: '美國', SFO: '美國', ORD: '美國', SEA: '美國', JFK: '美國', YVR: '加拿大',
  SYD: '澳洲', MEL: '澳洲', AKL: '新西蘭',
};

function getCountry(deal: Deal): string {
  return CITY_TO_COUNTRY[deal.destination.code] || deal.destination.region;
}

export default function Home() {
  const [departure, setDeparture] = useState<Departure>('HKG');
  const [sortBy, setSortBy] = useState<SortOption>('price');
  const [filterMode, setFilterMode] = useState<FilterMode>('region');
  const [selectedRegion, setSelectedRegion] = useState<string>('全部');
  const [selectedCountry, setSelectedCountry] = useState<string>('全部');
  const [comparePeriod, setComparePeriod] = useState<ComparePeriod>('now');

  // Live data state — fetched from /api/deals which proxies to the NAS.
  // We seed with the static JSON so the first paint isn't empty; then refresh.
  const [liveData, setLiveData] = useState<FlightData>(staticHkg as unknown as FlightData);
  const [dataAge, setDataAge] = useState<number>(0);
  const [dataSource, setDataSource] = useState<'live' | 'static'>('static');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/deals?dep=${departure}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: FlightData = await res.json();
        if (cancelled) return;
        setLiveData(json);
        const ageHeader = res.headers.get('x-data-age-ms');
        setDataAge(ageHeader ? Number(ageHeader) : 0);
        setDataSource(res.headers.get('x-data-source') === 'static-fallback' ? 'static' : 'live');
      } catch (err) {
        console.warn('Failed to fetch live deals, using static:', err);
        if (!cancelled) {
          setLiveData((departure === 'HKG' ? staticHkg : staticSzx) as unknown as FlightData);
          setDataSource('static');
        }
      }
    };
    load();
    // Refresh every 90s in the background so the page stays current
    const interval = setInterval(load, 90_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [departure]);

  const allData = liveData;
  const deals = (allData.results || []) as Deal[];
  const szxLoading = departure === 'SZX' && deals.length === 0;

  const countries = useMemo(() => {
    const uniqueCountries = [...new Set(deals.map((d) => getCountry(d)))];
    return ['全部', ...uniqueCountries.sort()];
  }, [deals]);

  const filteredAndSortedDeals = useMemo(() => {
    let result = [...deals];
    if (filterMode === 'region') {
      if (selectedRegion !== '全部') {
        result = result.filter((d) => d.destination.region === selectedRegion);
      }
    } else {
      if (selectedCountry !== '全部') {
        result = result.filter((d) => getCountry(d) === selectedCountry);
      }
    }
    if (sortBy === 'price') {
      result.sort((a, b) => a.price - b.price);
    } else if (sortBy === 'discount') {
      result.sort((a, b) => {
        const discountA = a.typicalPrice > 0 ? ((a.typicalPrice - a.price) / a.typicalPrice) * 100 : 0;
        const discountB = b.typicalPrice > 0 ? ((b.typicalPrice - b.price) / b.typicalPrice) * 100 : 0;
        return discountB - discountA;
      });
    }
    return result;
  }, [deals, sortBy, filterMode, selectedRegion, selectedCountry]);

  const discount = (deal: Deal) => {
    if (!deal.typicalPrice || deal.typicalPrice <= 0) return null;
    return Math.round(((deal.typicalPrice - deal.price) / deal.typicalPrice) * 100);
  };

  // Get comparison price for a deal (based on selected period)
  const getComparePrice = (deal: Deal): number | null => {
    if (comparePeriod === 'now') return null;
    // Use the cheapest date's history for the comparison period
    const cd = deal.cheapestDates[0];
    if (!cd?.history?.[comparePeriod]) return null;
    return cd.history[comparePeriod].price;
  };

  const getCompareDiff = (deal: Deal): { diff: number; pct: number } | null => {
    if (comparePeriod === 'now') return null;
    const cd = deal.cheapestDates[0];
    if (!cd?.history?.[comparePeriod]) return null;
    const old = cd.history[comparePeriod].price;
    const diff = deal.price - old;
    const pct = old > 0 ? Math.round((diff / old) * 100) : 0;
    return { diff, pct };
  };

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="mx-auto max-w-5xl px-4">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">CompareTiger</h1>
          <p className="mt-2 text-lg text-muted-foreground">{DEPARTURE_LABELS[departure].subtitle}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {dataSource === 'live' ? (
              <>🟢 即時資料 · 更新於 {Math.max(1, Math.round(dataAge / 1000))} 秒前</>
            ) : (
              <>🟡 顯示靜態備份資料（NAS 連線中斷）</>
            )}
          </p>
        </div>

        {/* Departure Selector */}
        <div className="mb-6 flex justify-center">
          <div className="inline-flex rounded-lg border border-border bg-card p-1 gap-1">
            <button
              onClick={() => setDeparture('HKG')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                departure === 'HKG'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              🛫 香港國際機場 (HKG)
            </button>
            <button
              onClick={() => setDeparture('SZX')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                departure === 'SZX'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              🛫 深圳寶安機場 (SZX)
            </button>
          </div>
        </div>

        {/* Loading state for SZX */}
        {szxLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="text-4xl mb-4">🔄</div>
            <p className="text-lg text-muted-foreground">深圳航班資料掃描中...</p>
            <p className="text-sm text-muted-foreground mt-1">預計 60-90 分鐘後完成首次掃描</p>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="mb-6 flex justify-center flex-wrap items-end gap-x-8 gap-y-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-emerald-600">{deals.length}</div>
                <div className="text-xs text-muted-foreground">個目的地</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-emerald-600">
                  {deals.length > 0 ? `$${Math.min(...deals.map(d => d.price)).toLocaleString()}` : '—'}
                </div>
                <div className="text-xs text-muted-foreground">最低價</div>
              </div>
              <Link
                href="/deals"
                className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-sm font-bold text-orange-600 dark:text-orange-400 transition-all hover:bg-orange-500/20 hover:border-orange-500/60 hover:shadow-md hover:shadow-orange-500/20"
              >
                🔥 今日劈價
              </Link>
            </div>

            {/* Filters & Sort */}
            <div className="mb-6 space-y-3">
              {/* Filter Mode Toggle */}
              <div className="flex gap-2">
                <Button
                  variant={filterMode === 'region' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setFilterMode('region'); setSelectedRegion('全部'); }}
                >
                  🌍 按地區
                </Button>
                <Button
                  variant={filterMode === 'country' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setFilterMode('country'); setSelectedCountry('全部'); }}
                >
                  ✈️ 按國家
                </Button>
              </div>

              {/* Region Filter */}
              {filterMode === 'region' && (
                <div className="flex flex-wrap gap-2">
                  {regions.map((region) => (
                    <Button
                      key={region}
                      variant={selectedRegion === region ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedRegion(region)}
                      className="text-xs"
                    >
                      {region}
                    </Button>
                  ))}
                </div>
              )}

              {/* Country Filter */}
              {filterMode === 'country' && (
                <select
                  value={selectedCountry}
                  onChange={(e) => setSelectedCountry(e.target.value)}
                  className="w-full max-w-xs rounded-lg border border-input bg-background px-3 py-2 text-sm"
                >
                  {countries.map((country) => (
                    <option key={country} value={country}>{country}</option>
                  ))}
                </select>
              )}

              {/* Sort + Compare Options */}
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">比較：</span>
                  <div className="inline-flex rounded-md border border-border bg-card p-0.5 gap-0.5">
                    {(Object.keys(COMPARE_LABELS) as ComparePeriod[]).map((p) => {
                      const hasData = deals.some(d => p === 'now' || d.cheapestDates[0]?.history?.[p]);
                      return (
                        <button
                          key={p}
                          onClick={() => setComparePeriod(p)}
                          disabled={!hasData && p !== 'now'}
                          className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                            comparePeriod === p
                              ? 'bg-sky-600 text-white'
                              : hasData
                                ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                : 'text-muted-foreground/40 cursor-not-allowed'
                          }`}
                        >
                          {COMPARE_LABELS[p]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">排序：</span>
                  <div className="inline-flex rounded-md border border-border bg-card p-0.5 gap-0.5">
                    <button
                      onClick={() => setSortBy('price')}
                      className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                        sortBy === 'price' ? 'bg-sky-600 text-white' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                      }`}
                    >
                      💰 最低價
                    </button>
                    <button
                      onClick={() => setSortBy('discount')}
                      className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                        sortBy === 'discount' ? 'bg-sky-600 text-white' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                      }`}
                    >
                      🔥 最抵
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Results count */}
            <p className="mb-4 text-sm text-muted-foreground">
              顯示 {filteredAndSortedDeals.length} 個目的地
            </p>

            {/* Destinations Grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredAndSortedDeals.map((dest) => {
                const discountPct = discount(dest);
                const diff = getCompareDiff(dest);
                return (
                  <Link key={dest.route} href={`/route/${dest.destination.code}?dep=${departure}`} className="group">
                    <Card className="transition-all duration-200 hover:border-sky-500/50 hover:shadow-lg hover:shadow-sky-500/10">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-xl">{dest.destination.name}</CardTitle>
                            <p className="text-sm text-muted-foreground">{dest.destination.code}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-bold text-emerald-600">${dest.price.toLocaleString()}</div>
                            {diff !== null && (
                              <div className={`text-xs font-medium ${
                                diff.diff < 0 ? 'text-emerald-600' : diff.diff > 0 ? 'text-red-500' : 'text-muted-foreground'
                              }`}>
                                {diff.diff < 0 ? '↓' : '↑'}{Math.abs(diff.diff).toLocaleString()} ({diff.diff < 0 ? '-' : '+'}{Math.abs(diff.pct)}%)
                              </div>
                            )}
                            <div className="text-xs text-muted-foreground">起</div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`${regionColors[dest.destination.region] || 'bg-slate-500/10 text-slate-600 border-slate-500/30'}`}
                            >
                              {dest.destination.region}
                            </Badge>
                            {discountPct !== null && discountPct > 0 && (
                              <Badge variant="destructive" className="text-xs">
                                -{discountPct}%
                              </Badge>
                            )}
                            {diff !== null && (
                              <Badge variant="outline" className="text-xs text-muted-foreground border-muted-foreground/30">
                                vs {COMPARE_LABELS[comparePeriod]}
                              </Badge>
                            )}
                          </div>
                          <span className="text-sm text-sky-600 transition-colors group-hover:text-sky-500">
                            查看詳情 →
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
