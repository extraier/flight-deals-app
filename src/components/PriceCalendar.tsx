'use client';

import { useState } from 'react';
import {
  WEEKDAYS,
  googleFlightsHref,
  historyRows,
  priceHeat,
  savingsVsTypical,
  type CalendarCell,
  type PriceCalendar as PriceCalendarData,
} from '@/lib/priceCalendar';
import { fixCityName } from '@/lib/cityNames';

export function PriceCalendar({ data, title }: { data: PriceCalendarData; title?: string }) {
  const [selected, setSelected] = useState<CalendarCell | null>(null);
  const heading = fixCityName(title || data.name);

  return (
    <section className="mb-8 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-card-foreground">{heading}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            香港出發 · 約四個月 · 平價偏綠，貴價偏橙
          </p>
        </div>
        <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground">
          {data.stayLabel}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid gap-4 sm:grid-cols-2">
          {data.months.map((month) => (
            <div key={month.key}>
              <h3 className="mb-2 text-sm font-semibold text-foreground">{month.label}</h3>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="py-0.5">{day}</div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {month.weeks.flat().map((cell, index) => (
                  <DayCell
                    key={`${month.key}-${index}`}
                    cell={cell}
                    minPrice={data.minPrice}
                    maxPrice={data.maxPrice}
                    selected={selected?.date === cell.date && !!cell.date}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <DayPanel cell={selected} dest={data.dest} typicalPrice={data.typicalPrice} />
      </div>
    </section>
  );
}

function DayCell({
  cell,
  minPrice,
  maxPrice,
  selected,
  onSelect,
}: {
  cell: CalendarCell;
  minPrice: number;
  maxPrice: number;
  selected: boolean;
  onSelect: (cell: CalendarCell) => void;
}) {
  if (!cell.inMonth) return <div className="aspect-square" />;
  if (cell.price == null) {
    return (
      <div
        className="flex aspect-square items-center justify-center rounded-md bg-muted/30 text-[11px] text-muted-foreground/40"
        aria-label={`${cell.date} 無資料`}
      >
        {cell.day}
      </div>
    );
  }
  const heat = priceHeat(cell.price, minPrice, maxPrice);
  return (
    <button
      type="button"
      onClick={() => onSelect(cell)}
      className={`flex aspect-square flex-col items-center justify-center rounded-md px-0.5 leading-none transition ${heatClass(heat)} ${
        selected ? 'ring-2 ring-foreground' : 'hover:brightness-110'
      }`}
      aria-pressed={selected}
      aria-label={`${cell.date} HK$${Math.round(cell.price)}`}
    >
      <span className="text-[10px] opacity-80">{cell.day}</span>
      <span className="mt-0.5 text-[9px] font-semibold sm:text-[10px]">{compactPrice(cell.price)}</span>
    </button>
  );
}

function DayPanel({
  cell,
  dest,
  typicalPrice,
}: {
  cell: CalendarCell | null;
  dest: string;
  typicalPrice: number;
}) {
  if (!cell || cell.price == null) {
    return (
      <aside className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        點選有價錢的日子，查看 7 日來回詳情。
      </aside>
    );
  }
  const save = savingsVsTypical(cell.price, typicalPrice);
  const history = historyRows(cell.price, cell.history);
  const href = googleFlightsHref(dest, cell.date, cell.retDate);
  return (
    <aside className="rounded-xl border border-border bg-background p-4">
      <p className="text-sm font-medium text-foreground">{formatLong(cell.date)}</p>
      <p className="mt-2 text-3xl font-bold text-emerald-600">HK${Math.round(cell.price).toLocaleString('en-HK')}</p>
      <p className="text-xs text-muted-foreground">7日來回</p>
      {save != null && save > 0 && (
        <p className="mt-3 text-sm font-medium text-emerald-600">較平時低 {save}%</p>
      )}
      {history.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {history.map((row) => (
            <li key={row.key}>
              較{row.label}{row.pct < 0 ? '低' : row.pct > 0 ? '高' : '持平'}
              {row.pct !== 0 ? ` ${Math.abs(row.pct)}%` : ''}
              <span className="ml-1">（HK${Math.round(row.oldPrice).toLocaleString('en-HK')}）</span>
            </li>
          ))}
        </ul>
      )}
      {cell.lastVerified && (
        <p className="mt-3 text-[11px] text-muted-foreground">最後核實：{cell.lastVerified}</p>
      )}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 flex w-full items-center justify-center rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        在 Google Flights 查看
      </a>
    </aside>
  );
}

function heatClass(heat: number): string {
  if (heat <= 0.2) return 'bg-emerald-500 text-white';
  if (heat <= 0.4) return 'bg-emerald-700 text-emerald-50';
  if (heat <= 0.6) return 'bg-teal-800 text-teal-50';
  if (heat <= 0.8) return 'bg-amber-700 text-amber-50';
  return 'bg-orange-800 text-orange-50';
}

function compactPrice(price: number): string {
  const rounded = Math.round(price);
  if (rounded >= 10000) return `${(rounded / 1000).toFixed(1)}k`;
  return rounded.toLocaleString('en-HK');
}

function formatLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}
