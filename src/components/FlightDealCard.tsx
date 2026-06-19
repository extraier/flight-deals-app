'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface FlightInfo {
  airline: string;
  flight_no: string;
  dep_time: string;
  arr_time?: string;
  return_airline?: string;
  return_dep_time?: string;
  return_arr_time?: string;
}

interface DateInfo {
  day: number;
  month: number;
  year: number;
  price: number;
  stay: number | null;
  flight?: FlightInfo;
}

interface Deal {
  route: string;
  destination: { name: string; code: string; region: string };
  price: number;
  currency: string;
  badge?: { carryOn?: boolean; duration?: number; cheapDays?: number };
  typicalPrice: number;
  cheapestDates: DateInfo[];
  totalDestinations: number;
  moreMonths?: number;
}

interface FlightDealCardProps {
  deal: Deal;
  onMoreMonths?: () => void;
}

export function FlightDealCard({ deal, onMoreMonths }: FlightDealCardProps) {
  const { destination, price, badge, cheapestDates, moreMonths, typicalPrice } = deal;

  // Only show dates at the cheapest price (green dates)
  const cheapestPrice = price;
  const greenDates = cheapestDates.filter(d => d.price === cheapestPrice);

  // Group green dates by month
  const datesByMonth: Record<string, typeof greenDates> = {};
  greenDates.forEach((date) => {
    const key = `${date.year}-${String(date.month).padStart(2, '0')}`;
    if (!datesByMonth[key]) datesByMonth[key] = [];
    datesByMonth[key].push(date);
  });

  const monthNames: Record<string, string> = {
    '2026-06': '6月',
    '2026-07': '7月',
    '2026-08': '8月',
    '2026-09': '9月',
    '2026-10': '10月',
    '2026-11': '11月',
    '2026-12': '12月',
    '2027-01': '1月',
    '2027-02': '2月',
    '2027-03': '3月',
    '2027-04': '4月',
    '2027-05': '5月',
    '2027-06': '6月',
  };

  return (
    <Card className="overflow-hidden border-slate-800 bg-card">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-slate-50">{destination.name}</h2>
            <p className="text-sm text-slate-400">
              {destination.region} · {destination.code}
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-emerald-400">${price.toLocaleString()}</div>
            <div className="text-sm text-slate-400">來回</div>
          </div>
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-2 px-6 py-4">
        {badge?.carryOn && (
          <Badge variant="secondary" className="bg-slate-800 text-slate-300 hover:bg-slate-700">
            🧳 手提
          </Badge>
        )}
        {badge?.duration && (
          <Badge variant="secondary" className="bg-slate-800 text-slate-300 hover:bg-slate-700">
            📅 {badge.duration}日行程
          </Badge>
        )}
        {badge?.cheapDays && (
          <Badge variant="secondary" className="bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/50">
            💰 {badge.cheapDays} 個平價日子
          </Badge>
        )}
      </div>

      {/* Legend - shows cheapest price */}
      <div className="px-6 pb-4">
        <p className="text-xs text-slate-500">
          綠色日子 ~${cheapestPrice.toLocaleString()} 來回
        </p>
      </div>

      <Separator className="bg-slate-800" />

      {/* Calendar Grid - only green dates */}
      <div className="p-6">
        <div className="space-y-4">
          {Object.entries(datesByMonth)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([monthKey, dates]) => (
              <div key={monthKey} className="flex items-start gap-4">
                {/* Month Label */}
                <span className="w-10 shrink-0 text-right text-sm font-medium text-slate-400">
                  {monthNames[monthKey] || monthKey}
                </span>

                {/* Date Badges */}
                <div className="flex flex-wrap gap-2">
                  {dates
                    .sort((a, b) => a.day - b.day)
                    .map((date, idx) => (
                      <div
                        key={idx}
                        className="inline-flex flex-col gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm transition-colors hover:bg-emerald-500/20"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-emerald-400">{date.day}號</span>
                          {date.stay && (
                            <span className="text-xs text-slate-400">{date.stay}日</span>
                          )}
                        </div>
                        {date.flight && (
                          <div className="flex items-center gap-1 text-xs">
                            <span className="font-medium text-slate-300">{date.flight.airline}</span>
                            <span className="text-slate-400">{date.flight.flight_no}</span>
                            <span className="text-slate-500">·</span>
                            <span className="text-slate-300">{date.flight.dep_time}</span>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/50 px-6 py-4">
        {moreMonths !== undefined && moreMonths > 0 && (
          <button
            onClick={onMoreMonths}
            className="text-sm font-medium text-sky-400 transition-colors hover:text-sky-300"
          >
            + 仲有 {moreMonths} 個月
          </button>
        )}
        {deal.totalDestinations && (
          <span className="text-xs text-slate-500">
            共 {deal.totalDestinations} 個目的地
          </span>
        )}
      </div>
    </Card>
  );
}
