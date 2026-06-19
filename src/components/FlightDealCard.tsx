'use client';

import { FlightDeal } from '@/types/flight';

interface FlightDealCardProps {
  deal: FlightDeal;
  onMoreMonths?: () => void;
}

export function FlightDealCard({ deal, onMoreMonths }: FlightDealCardProps) {
  const { destination, price, badge, cheapestDates, moreMonths, typicalPrice } = deal;

  // Group dates by month
  const datesByMonth: Record<string, typeof cheapestDates> = {};
  cheapestDates.forEach((date) => {
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
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-[#202c3d] bg-[#16202c] p-4">
      {/* Header: Destination + Price */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#e2e8f0]">{destination.name}</h2>
          <p className="text-sm text-[#708090]">
            {destination.region} · {destination.code}
          </p>
        </div>
        <div className="text-right">
          <span className="text-2xl font-bold text-[#00e676]">${price}</span>
          <span className="ml-1 text-sm text-[#e2e8f0]">來回</span>
        </div>
      </div>

      {/* Badges */}
      <div className="mt-3 flex flex-wrap gap-2">
        {badge?.carryOn && (
          <span className="rounded-full bg-[#222d3c] px-3 py-1 text-xs text-[#8a99ad]">
            手提
          </span>
        )}
        {badge?.duration && (
          <span className="rounded-full bg-[#222d3c] px-3 py-1 text-xs text-[#8a99ad]">
            {badge.duration}日行程
          </span>
        )}
        {badge?.cheapDays && (
          <span className="rounded-full bg-[#222d3c] px-3 py-1 text-xs text-[#8a99ad]">
            {badge.cheapDays} 個平價日子
          </span>
        )}
      </div>

      {/* Legend */}
      {typicalPrice && (
        <p className="mt-3 text-xs text-[#708090]">
          綠色日子 ~${typicalPrice} 來回
        </p>
      )}

      {/* Calendar Grid by Month */}
      <div className="mt-3 space-y-3">
        {Object.entries(datesByMonth)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([monthKey, dates]) => (
            <div key={monthKey} className="flex items-start gap-3">
              {/* Month Label */}
              <span className="w-8 shrink-0 text-right text-sm text-[#708090]">
                {monthNames[monthKey] || monthKey}
              </span>

              {/* Date Badges */}
              <div className="flex flex-wrap gap-2">
                {dates
                  .sort((a, b) => a.day - b.day)
                  .map((date, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#00e676]/30 bg-[#16202c] px-2 py-1 text-xs"
                    >
                      <span className="font-medium text-[#00e676]">
                        {date.day}號
                      </span>
                      {date.duration && (
                        <span className="text-[#708090]">{date.duration}日</span>
                      )}
                    </span>
                  ))}
              </div>
            </div>
          ))}
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between">
        {moreMonths !== undefined && moreMonths > 0 && (
          <button
            onClick={onMoreMonths}
            className="text-sm font-medium text-[#3da8f5] hover:underline"
          >
            + 仲有 {moreMonths} 個月
          </button>
        )}
        {deal.totalDestinations && (
          <span className="text-xs text-[#708090]">
            共 {deal.totalDestinations} 個目的地
          </span>
        )}
      </div>
    </div>
  );
}
