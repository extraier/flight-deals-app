'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import realDeals from '@/data/real-deals.json';

type SortOption = 'price' | 'discount';
type FilterMode = 'region' | 'country';

const regionColors: Record<string, string> = {
  '東南亞': 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  '東亞': 'bg-sky-500/10 text-sky-600 border-sky-500/30',
  '中國': 'bg-red-500/10 text-red-600 border-red-500/30',
  '大洋洲': 'bg-cyan-500/10 text-cyan-600 border-cyan-500/30',
  '北美洲': 'bg-red-500/10 text-red-600 border-red-500/30',
  '歐洲': 'bg-violet-500/10 text-violet-600 border-violet-500/30',
  '南亞': 'bg-orange-500/10 text-orange-600 border-orange-500/30',
  '中東': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  '非洲': 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  '香港': 'bg-pink-500/10 text-pink-600 border-pink-500/30',
};

const regions = ['全部', '東亞', '東南亞', '中國', '大洋洲', '北美洲', '歐洲', '南亞', '中東', '非洲'];

export default function Home() {
  const [sortBy, setSortBy] = useState<SortOption>('price');
  const [filterMode, setFilterMode] = useState<FilterMode>('region');
  const [selectedRegion, setSelectedRegion] = useState<string>('全部');
  const [selectedCountry, setSelectedCountry] = useState<string>('全部');

  const deals = realDeals as any[];

  // Get unique countries from data
  const countries = useMemo(() => {
    const uniqueCountries = [...new Set(deals.map((d) => d.destination.name))].sort();
    return ['全部', ...uniqueCountries];
  }, [deals]);

  const filteredAndSortedDeals = useMemo(() => {
    let result = [...deals];

    // Filter
    if (filterMode === 'region') {
      if (selectedRegion !== '全部') {
        result = result.filter((d) => d.destination.region === selectedRegion);
      }
    } else {
      if (selectedCountry !== '全部') {
        result = result.filter((d) => d.destination.name === selectedCountry);
      }
    }

    // Sort
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

  const discount = (deal: any) => {
    if (!deal.typicalPrice || deal.typicalPrice <= 0) return null;
    return Math.round(((deal.typicalPrice - deal.price) / deal.typicalPrice) * 100);
  };

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="mx-auto max-w-5xl px-4">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">CompareTiger</h1>
          <p className="mt-3 text-lg text-muted-foreground">香港國際機場 ✈️ 最低機票</p>
        </div>

        {/* Stats */}
        <div className="mb-6 flex justify-center gap-8">
          <div className="text-center">
            <div className="text-2xl font-bold text-emerald-600">{deals.length}</div>
            <div className="text-xs text-muted-foreground">個目的地</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-emerald-600">${deals[0]?.price.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">最低價</div>
          </div>
        </div>

        {/* Filters & Sort */}
        <div className="mb-6 space-y-3">
          {/* Filter Mode Toggle */}
          <div className="flex gap-2">
            <Button
              variant={filterMode === 'region' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setFilterMode('region');
                setSelectedRegion('全部');
              }}
            >
              🌍 按地區
            </Button>
            <Button
              variant={filterMode === 'country' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setFilterMode('country');
                setSelectedCountry('全部');
              }}
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
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
          )}

          {/* Sort Options */}
          <div className="flex gap-2">
            <Button
              variant={sortBy === 'price' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSortBy('price')}
            >
              💰 最低價
            </Button>
            <Button
              variant={sortBy === 'discount' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSortBy('discount')}
            >
              🔥 最抵
            </Button>
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
            return (
              <Link key={dest.route} href={`/route/${dest.destination.code}`} className="group">
                <Card className="transition-all duration-200 hover:border-sky-500/50 hover:shadow-lg hover:shadow-sky-500/10">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-xl">{dest.destination.name}</CardTitle>
                        <p className="text-sm text-muted-foreground">{dest.destination.code}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-bold text-emerald-600">${dest.price.toLocaleString()}</div>
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
      </div>
    </div>
  );
}
