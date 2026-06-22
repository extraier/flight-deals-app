'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { X, AlertTriangle } from 'lucide-react';

interface FlightInfo {
  airline: string;
  flight_no: string;
  dep_time: string;
  arr_time?: string;
  return_airline?: string;
  return_dep_time?: string;
  return_arr_time?: string;
  return_flight?: string;
  ret_date?: string;
}

// Hermes: matches export_all_dates_*.py — history.1d is the price recorded
// yesterday; if it differs from the current price the calendar cell is stale.
interface HistoryPoint {
  price: number;
  diff: number;
  pct: number;
}

interface DateInfo {
  day: number;
  month: number;
  year: number;
  price: number;
  stay: number | null;
  flight?: FlightInfo;
  history?: Record<string, HistoryPoint>;
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
  departure?: 'HKG' | 'SZX';
}

export function FlightDealCard({ deal, onMoreMonths, departure = 'HKG' }: FlightDealCardProps) {
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
      <Card className="overflow-hidden border-border bg-card">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary/20 to-primary/10 p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-card-foreground">{destination.name}</h2>
              <p className="text-sm text-muted-foreground">
                {destination.region} · {destination.code}
              </p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">${price.toLocaleString()}</div>
              <div className="text-sm text-muted-foreground">來回</div>
            </div>
          </div>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-2 px-6 py-4">
          {badge?.carryOn && (
            <Badge variant="secondary" className="bg-secondary text-secondary-foreground hover:bg-secondary/80">
              🧳 手提
            </Badge>
          )}
          {badge?.duration && (
            <Badge variant="secondary" className="bg-secondary text-secondary-foreground hover:bg-secondary/80">
              📅 {badge.duration}日行程
            </Badge>
          )}
          {badge?.cheapDays && (
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20">
              💰 {badge.cheapDays} 個平價日子
            </Badge>
          )}
        </div>

        {/* Legend */}
        <div className="px-6 pb-4">
          <p className="text-xs text-muted-foreground">
            點擊日期查看航班詳情 · 綠色日子 ~${cheapestPrice.toLocaleString()} 來回
          </p>
        </div>

        <Separator />

        {/* Calendar Grid */}
        <div className="p-6">
          <div className="space-y-4">
            {Object.entries(datesByMonth)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([monthKey, dates]) => (
                <div key={monthKey} className="flex items-start gap-4">
                  <span className="w-10 shrink-0 text-right text-sm font-medium text-muted-foreground">
                    {monthNames[monthKey] || monthKey}
                  </span>

                  <div className="flex flex-wrap gap-2">
                    {dates
                      .sort((a, b) => a.day - b.day)
                      .map((date, idx) => {
                        // Hermes: stale-cell detection.
                        //   history.1d.diff = current_price - yesterday's_price
                        //     diff < 0  →  row is CHEAPER than yesterday (good)
                        //     diff > 0  →  row is MORE EXPENSIVE than yesterday
                        //   BUT — the scanner writes the LATEST scanned price,
                        //   while the calendar scanner reports a price that
                        //   may already be higher than what the row says. So
                        //   the row can show $4930 while yesterday's actual
                        //   was $5520 → diff = -590 → STALE (row lags reality).
                        //   The re-scan smart-skip policy (see detail scanner)
                        //   will catch up to $5520 within ~50 min.
                        const h1 = date.history?.['1d'];
                        const isStaleDown = !!h1 && h1.diff < -50;
                        const staleBadgeText = isStaleDown
                          ? `昨日HK$${Math.round(h1.price).toLocaleString()}`
                          : null;

                        return (
                        <button
                          key={idx}
                          onClick={() => setSelectedDate(date)}
                          title={isStaleDown
                            ? `昨日實際 HK$${Math.round(h1.price).toLocaleString()} · 此價格可能已回升，下次掃描約 50 分鐘內更新`
                            : undefined}
                          className={`relative inline-flex flex-col items-center gap-1 rounded-lg border px-3 py-1.5 text-sm transition-all cursor-pointer ${
                            isStaleDown
                              ? 'border-amber-500/40 bg-amber-500/10 hover:border-amber-500/60 hover:bg-amber-500/20'
                              : date.flight
                              ? 'border-emerald-500/30 bg-emerald-500/10 hover:border-emerald-500/50 hover:bg-emerald-500/20'
                              : 'border-border bg-secondary/30 hover:border-muted-foreground/30 hover:bg-secondary/50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${
                              isStaleDown
                                ? 'text-amber-700 dark:text-amber-400'
                                : date.flight
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-foreground'
                            }`}>
                              {date.day}號
                            </span>
                            {date.stay && (
                              <span className="text-xs text-muted-foreground">{date.stay}日</span>
                            )}
                          </div>
                          {isStaleDown ? (
                            <div className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                              <AlertTriangle className="h-3 w-3" />
                              <span>{staleBadgeText}</span>
                            </div>
                          ) : date.flight ? (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span>{date.flight.airline}</span>
                              <span>{date.flight.dep_time}</span>
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">詳情待確認</div>
                          )}
                        </button>
                        );
                      })}
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-6 py-4">
          {moreMonths !== undefined && moreMonths > 0 && (
            <button
              onClick={onMoreMonths}
              className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
            >
              + 仲有 {moreMonths} 個月
            </button>
          )}
          {deal.totalDestinations && (
            <span className="text-xs text-muted-foreground">
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
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-card-foreground">
                  {selectedDate.year}年{selectedDate.month}月{selectedDate.day}日
                </h3>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  HK${selectedDate.price.toLocaleString()} 來回
                </p>
              </div>
              <button
                onClick={() => setSelectedDate(null)}
                className="rounded-full p-1 hover:bg-secondary transition-colors"
              >
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>

            {/* Flight Details - with data */}
            {selectedDate.flight ? (
              <div className="space-y-4">
                {/* Outbound Flight */}
                <div className="rounded-xl bg-secondary p-4">
                  <p className="text-xs font-medium text-muted-foreground mb-3">去程 · {destination.name}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-primary font-bold">
                        →
                      </div>
                      <div>
                        <p className="font-bold text-card-foreground">
                          {selectedDate.flight.airline.replace(/^_/, '')} {selectedDate.flight.flight_no}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {selectedDate.flight.dep_time}
                          {selectedDate.flight.arr_time && ` → ${selectedDate.flight.arr_time}`}
                        </p>
                      </div>
                    </div>
                    {selectedDate.stay && (
                      <span className="text-xs text-muted-foreground">
                        {selectedDate.stay}日
                      </span>
                    )}
                  </div>
                </div>

                {/* Return Flight */}
                {selectedDate.flight.return_airline && (
                  <div className="rounded-xl bg-secondary p-4">
                    <p className="text-xs font-medium text-muted-foreground mb-3">回程 · 香港</p>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold">
                        ←
                      </div>
                      <div>
                        <p className="font-bold text-card-foreground">
                          {selectedDate.flight.return_airline.replace(/^_/, '')} {selectedDate.flight.return_flight || selectedDate.flight.flight_no}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {selectedDate.flight.return_dep_time}
                          {selectedDate.flight.return_arr_time && ` → ${selectedDate.flight.return_arr_time}`}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Action Button */}
                <a
                  href={`https://www.google.com/travel/flights?q=${departure}+to+${destination.code}+${selectedDate.year}-${String(selectedDate.month).padStart(2,'0')}-${String(selectedDate.day).padStart(2,'0')}+${selectedDate.flight?.ret_date}&gl=hk&hl=zh-TW&curr=HKD`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  HK${selectedDate.price.toLocaleString()} 來回 · 在 Google Flights 查看
                </a>
              </div>
            ) : (
              /* No flight data - show pending state */
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
                  <p className="text-amber-600 dark:text-amber-400 font-medium">⚠️ 詳情待確認</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    此日期航班詳情正在確認中，請稍後再試
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    票價: HK${selectedDate.price.toLocaleString()} · {selectedDate.stay}日行程
                  </p>
                </div>

                {/* Quick Google Search Link */}
                <a
                  href={`https://www.google.com/travel/flights?q=${departure}+to+${destination.code}+${selectedDate.year}-${String(selectedDate.month).padStart(2,'0')}-${String(selectedDate.day).padStart(2,'0')}&gl=hk&hl=zh-TW`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-secondary px-4 py-3 font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
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
