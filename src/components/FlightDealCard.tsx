'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { X } from 'lucide-react';

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
  const [selectedDate, setSelectedDate] = useState<DateInfo | null>(null);

  const cheapestPrice = price;
  const greenDates = cheapestDates.filter(d => d.price === cheapestPrice);

  const datesByMonth: Record<string, typeof greenDates> = {};
  greenDates.forEach((date) => {
    const key = `${date.year}-${String(date.month).padStart(2, '0')}`;
    if (!datesByMonth[key]) datesByMonth[key] = [];
    datesByMonth[key].push(date);
  });

  const monthNames: Record<string, string> = {
    '2026-06': '6月', '2026-07': '7月', '2026-08': '8月',
    '2026-09': '9月', '2026-10': '10月', '2026-11': '11月',
    '2026-12': '12月', '2027-01': '1月', '2027-02': '2月',
    '2027-03': '3月', '2027-04': '4月', '2027-05': '5月',
    '2026-01': '1月', '2026-02': '2月', '2026-03': '3月',
    '2026-04': '4月', '2026-05': '5月',
  };

  return (
    <>
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

        {/* Legend */}
        <div className="px-6 pb-4">
          <p className="text-xs text-slate-500">
            點擊日期查看航班詳情 · 綠色日子 ~${cheapestPrice.toLocaleString()} 來回
          </p>
        </div>

        <Separator className="bg-slate-800" />

        {/* Calendar Grid */}
        <div className="p-6">
          <div className="space-y-4">
            {Object.entries(datesByMonth)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([monthKey, dates]) => (
                <div key={monthKey} className="flex items-start gap-4">
                  <span className="w-10 shrink-0 text-right text-sm font-medium text-slate-400">
                    {monthNames[monthKey] || monthKey}
                  </span>

                  <div className="flex flex-wrap gap-2">
                    {dates
                      .sort((a, b) => a.day - b.day)
                      .map((date, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedDate(date)}
                          className={`inline-flex flex-col items-center gap-1 rounded-lg border px-3 py-1.5 text-sm transition-all cursor-pointer ${
                            date.flight 
                              ? 'border-emerald-500/30 bg-emerald-500/10 hover:border-emerald-400 hover:bg-emerald-500/20' 
                              : 'border-slate-600/30 bg-slate-700/20 hover:border-slate-500/50 hover:bg-slate-700/30'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${date.flight ? 'text-emerald-400' : 'text-slate-400'}`}>
                              {date.day}號
                            </span>
                            {date.stay && (
                              <span className="text-xs text-slate-500">{date.stay}日</span>
                            )}
                          </div>
                          {date.flight ? (
                            <div className="flex items-center gap-1 text-xs text-slate-400">
                              <span>{date.flight.airline}</span>
                              <span>{date.flight.dep_time}</span>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-500">詳情待確認</div>
                          )}
                        </button>
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

      {/* Flight Detail Modal */}
      {selectedDate && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelectedDate(null)}
        >
          <div 
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold">
                  {selectedDate.year}年{selectedDate.month}月{selectedDate.day}日
                </h3>
                <p className="text-2xl font-bold text-emerald-400 mt-1">
                  HK${selectedDate.price.toLocaleString()} 來回
                </p>
              </div>
              <button
                onClick={() => setSelectedDate(null)}
                className="rounded-full p-1 hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>

            {/* Flight Details - with data */}
            {selectedDate.flight ? (
              <div className="space-y-4">
                {/* Outbound Flight */}
                <div className="rounded-xl bg-slate-800/50 p-4">
                  <p className="text-xs font-medium text-slate-400 mb-3">去程 · {destination.name}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500/20 text-sky-400 font-bold">
                        →
                      </div>
                      <div>
                        <p className="font-bold text-slate-50">
                          {selectedDate.flight.airline} {selectedDate.flight.flight_no}
                        </p>
                        <p className="text-sm text-slate-400">
                          {selectedDate.flight.dep_time}
                          {selectedDate.flight.arr_time && ` → ${selectedDate.flight.arr_time}`}
                        </p>
                      </div>
                    </div>
                    {selectedDate.stay && (
                      <span className="text-xs text-slate-500">
                        {selectedDate.stay}日
                      </span>
                    )}
                  </div>
                </div>

                {/* Return Flight */}
                {selectedDate.flight.return_airline && (
                  <div className="rounded-xl bg-slate-800/50 p-4">
                    <p className="text-xs font-medium text-slate-400 mb-3">回程 · 香港</p>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold">
                        ←
                      </div>
                      <div>
                        <p className="font-bold text-slate-50">
                          {selectedDate.flight.return_airline} {selectedDate.flight.return_dep_time?.split(' ').pop()}
                        </p>
                        <p className="text-sm text-slate-400">
                          {selectedDate.flight.return_dep_time}
                          {selectedDate.flight.return_arr_time && ` → ${selectedDate.flight.return_arr_time}`}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Action Button */}
                <a
                  href={`https://www.google.com/travel/flights/search?tfs=CBwQAhopag&tfu=${selectedDate.flight.dep_time}&gl=hk`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 font-medium text-white transition-colors hover:bg-sky-500"
                >
                  在 Google Flights 查看
                </a>
              </div>
            ) : (
              /* No flight data - show pending state */
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
                  <p className="text-amber-400 font-medium">⚠️ 詳情待確認</p>
                  <p className="text-sm text-slate-400 mt-1">
                    此日期航班詳情正在確認中，請稍後再試
                  </p>
                  <p className="text-sm text-slate-500 mt-2">
                    票價: HK${selectedDate.price.toLocaleString()} · {selectedDate.stay}日行程
                  </p>
                </div>

                {/* Quick Google Search Link */}
                <a
                  href={`https://www.google.com/travel/flights?q=${destination.code}+to+HKG+${selectedDate.year}-${String(selectedDate.month).padStart(2, '0')}-${String(selectedDate.day).padStart(2, '0')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-700 px-4 py-3 font-medium text-slate-300 transition-colors hover:bg-slate-600"
                >
                  🔍 在 Google Flights 搜尋
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
