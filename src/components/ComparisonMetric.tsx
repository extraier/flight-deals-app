'use client';

import { TrendingDown, TrendingUp, AlertCircle } from 'lucide-react';
import type {
  DateComparison,
  HistoryComparison,
  MarketComparison,
} from '@/types/flight';

/**
 * Hermes 2026-08-23: Renders the three ComparisonSummary blocks that the
 * exporter emits per route. The intent is to surface "this price is X%
 * below the route's same-stay median" and "vs yesterday's price" as
 * discrete badges, rather than burying them in the date grid.
 *
 * The component intentionally renders nothing for `insufficient_data`
 * (too few peers) and `not_collected` (no data). The header bar is
 * reserved for the price + destination; the badges belong here so the
 * layout doesn't shift between ready / insufficient / not-collected.
 */
export function ComparisonMetric({
  dateComparison,
  historyComparison,
  marketComparison,
}: {
  dateComparison?: DateComparison;
  historyComparison?: HistoryComparison;
  marketComparison?: MarketComparison;
}) {
  if (!dateComparison && !historyComparison && !marketComparison) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 px-6 py-3 border-b border-border bg-muted/20">
      {dateComparison && dateComparison.status === 'ready' && (
        <DateComparisonBadge comparison={dateComparison} />
      )}
      {historyComparison && historyComparison.status === 'ready' && (
        <HistoryComparisonBadge comparison={historyComparison} />
      )}
      {marketComparison?.status === 'not_collected' && (
        <MarketNotCollectedBadge reason={marketComparison.reason} />
      )}
    </div>
  );
}

function DateComparisonBadge({ comparison }: { comparison: DateComparison }) {
  const pct = comparison.pricePercentile ?? 0;
  const vsMedian = comparison.vsMedian ?? 0;
  const isCheap = vsMedian < 0;
  // pricePercentile is the % of peers STRICTLY CHEAPER. Lower = better.
  const cheapPct = (100 - pct).toFixed(0);
  const Icon = isCheap ? TrendingDown : TrendingUp;
  const colourClass = isCheap
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${colourClass}`}
      title={`Cheaper than ${cheapPct}% of ${comparison.sampleSize} same-stay peers in this calendar pool`}
    >
      <Icon className="h-3 w-3" />
      <span>
        比 {comparison.sampleSize} 個同住宿日曆平 {cheapPct}%
      </span>
      {comparison.vsMedian !== undefined && (
        <span className="text-muted-foreground">
          · 中位數 {comparison.median?.toLocaleString()}
        </span>
      )}
    </div>
  );
}

function HistoryComparisonBadge({ comparison }: { comparison: HistoryComparison }) {
  const vsMedian = comparison.vsMedian ?? 0;
  if (comparison.sampleSize < 1) return null;
  const isCheap = vsMedian < 0;
  const Icon = isCheap ? TrendingDown : TrendingUp;
  const colourClass = isCheap
    ? 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${colourClass}`}
      title={`Based on ${comparison.sampleSize} historical observations`}
    >
      <Icon className="h-3 w-3" />
      <span>
        vs 歷史中位數 {isCheap ? '低' : '高'} {Math.abs(vsMedian).toFixed(1)}%
      </span>
    </div>
  );
}

function MarketNotCollectedBadge({ reason }: { reason: string }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-500/30 bg-slate-500/10 px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-400"
      title={reason}
    >
      <AlertCircle className="h-3 w-3" />
      <span>市場比較待授權來源確認</span>
    </div>
  );
}
