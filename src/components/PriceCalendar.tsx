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

const CANVAS = '#0C0C0C';
const CREAM = '#F0F0E8';
const MUTED = '#8A8A82';

const HEAT_STOPS: Array<{ t: number; label: string; rgb: [number, number, number] }> = [
  { t: 0, label: '超低', rgb: [0x4c, 0xb4, 0x88] },
  { t: 0.25, label: '低', rgb: [0x2c, 0x6c, 0x54] },
  { t: 0.5, label: '一般', rgb: [0xc8, 0x88, 0x4c] },
  { t: 0.75, label: '稍貴', rgb: [0xb0, 0x58, 0x30] },
  { t: 1, label: '貴', rgb: [0xa0, 0x48, 0x28] },
];

export function PriceCalendar({ data, title }: { data: PriceCalendarData; title?: string }) {
  const [selected, setSelected] = useState<CalendarCell | null>(null);
  const heading = fixCityName(title || data.name);

  return (
    <section className="mb-8 rounded-2xl px-4 py-5 sm:px-6 sm:py-6" style={{ background: CANVAS, color: CREAM }}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight" style={{ color: CREAM }}>{heading}</h2>
          <p className="mt-1 text-xs" style={{ color: MUTED }}>
            香港出發 · 約四個月 · 平價偏綠，貴價偏橙
          </p>
        </div>
        <span
          className="rounded-full px-3 py-1 text-xs"
          style={{ color: CREAM, border: '1px solid rgba(240,240,232,0.28)' }}
        >
          {data.stayLabel}
        </span>
      </div>

      <HeatLegend />

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-6 sm:grid-cols-2">
          {data.months.map((month) => (
            <div key={month.key}>
              <h3 className="mb-2 text-sm font-medium" style={{ color: CREAM }}>{month.label}</h3>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px]" style={{ color: MUTED }}>
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

function HeatLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: MUTED }}>
      {HEAT_STOPS.map((stop) => (
        <span key={stop.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: rgb(stop.rgb) }} />
          {stop.label}
        </span>
      ))}
    </div>
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
  if (!cell.inMonth) return <div className="min-h-11" />;
  if (cell.price == null) {
    return (
      <div
        className="flex min-h-11 items-start rounded-sm px-1 pt-1 text-[10px]"
        style={{ color: '#5C5C56' }}
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
      className="flex min-h-11 flex-col items-stretch rounded-sm px-1 py-1 text-left leading-none transition hover:brightness-110"
      style={{
        background: heatColor(heat),
        color: CREAM,
        outline: selected ? `1px solid ${CREAM}` : '1px solid transparent',
        outlineOffset: '1px',
      }}
      aria-pressed={selected}
      aria-label={`${cell.date} HK$${Math.round(cell.price)}`}
    >
      <span className="text-[10px]" style={{ color: 'rgba(240,240,232,0.72)' }}>{cell.day}</span>
      <span className="mt-1 text-[11px] font-medium tracking-tight sm:text-xs">{compactPrice(cell.price)}</span>
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
      <aside className="text-sm leading-relaxed" style={{ color: MUTED }}>
        點選有價錢的日子，查看 7 日來回詳情。
      </aside>
    );
  }
  const save = savingsVsTypical(cell.price, typicalPrice);
  const history = historyRows(cell.price, cell.history);
  const href = googleFlightsHref(dest, cell.date, cell.retDate);
  return (
    <aside>
      <p className="text-sm" style={{ color: CREAM }}>
        去 {formatLong(cell.date)}
        {cell.retDate ? <span style={{ color: MUTED }}> · 返 {formatLong(cell.retDate)}</span> : null}
      </p>
      <p className="mt-3 text-4xl font-semibold tracking-tight" style={{ color: CREAM }}>
        HK${Math.round(cell.price).toLocaleString('en-HK')}
      </p>
      <p className="mt-1 text-xs" style={{ color: MUTED }}>7日來回</p>
      {save != null && save > 0 && (
        <p className="mt-4 text-sm" style={{ color: '#4CB488' }}>較平時低 {save}%</p>
      )}
      {history.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs" style={{ color: '#C8C8BE' }}>
          {history.map((row) => (
            <li key={row.key}>
              較{row.label}{row.pct < 0 ? '低' : row.pct > 0 ? '高' : '持平'}
              {row.pct !== 0 ? ` ${Math.abs(row.pct)}%` : ''}
              <span style={{ color: MUTED }}>（HK${Math.round(row.oldPrice).toLocaleString('en-HK')}）</span>
            </li>
          ))}
        </ul>
      )}
      {cell.lastVerified && (
        <p className="mt-4 text-[11px]" style={{ color: MUTED }}>最後核實：{cell.lastVerified}</p>
      )}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 inline-flex text-sm underline decoration-white/40 underline-offset-4 hover:decoration-white"
        style={{ color: CREAM }}
      >
        在 Google Flights 查看
      </a>
    </aside>
  );
}

function heatColor(t: number): string {
  let left = HEAT_STOPS[0];
  let right = HEAT_STOPS[HEAT_STOPS.length - 1];
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    if (t >= HEAT_STOPS[i].t && t <= HEAT_STOPS[i + 1].t) {
      left = HEAT_STOPS[i];
      right = HEAT_STOPS[i + 1];
      break;
    }
  }
  const span = right.t - left.t || 1;
  const mix = (t - left.t) / span;
  const rgb = left.rgb.map((channel, i) => Math.round(channel + (right.rgb[i] - channel) * mix)) as [number, number, number];
  return rgbToCss(rgb);
}

function rgb(value: [number, number, number]): string {
  return rgbToCss(value);
}

function rgbToCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r} ${g} ${b})`;
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
