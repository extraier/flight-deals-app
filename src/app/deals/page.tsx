'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type Departure = 'HKG' | 'SZX';
type SortMode = 'discount' | 'recency';

interface Deal {
  route: string;
  destination: { name: string; code: string; region: string };
  price: number;
  currency?: string;           // optional: not always present in scanner JSON
  badge?: { carryOn?: boolean; cheapDays?: number };
  typicalPrice?: number;
  firstDetected?: string | null;  // ISO timestamp from scanner export
  // Hermes 2026-07-09: destination-level drop stamped by the scanner export
  // (export_all_dates_*.py). When present, the client uses these instead of
  // re-deriving from cheapestDates[0].history.1d (which is a single-date
  // comparison, not destination-level). Pre-2026-06-23 routes won't have
  // these fields, so buildDropList falls back to the old logic.
  dropAmount?: number;
  dropPct?: number;
  dropPrice?: number;
  // Hermes 2026-07-09: pending-scan stamp. When the calendar scanner sees a
  // price well below typical but the detail scanner hasn't yet confirmed the
  // drop (no history.1d baseline exists for the cheapest date), the export
  // sets pendingScans to the count of top-30 cheapest dates lacking detail
  // info. The deals page renders these in a separate "Pending" section with
  // a ⏳ badge so the user sees likely-drops sooner than waiting for the
  // detail scanner's confirmation cycle.
  pendingScans?: number;
  pendingFirstSeen?: string | null;
  // Hermes 2026-09-29: airline code (e.g. "UO", "CX") at destination level.
  // Used by buildDropList to match the cooldown key format "HKG→UO→CODE".
  airline?: string;
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
  oldPrice: number;        // yesterday's lowest (or typicalPrice fallback)
  newPrice: number;        // today's lowest
  dropAmount: number;      // oldPrice - newPrice (positive = drop)
  dropPct: number;         // round((oldPrice - newPrice) / oldPrice * 100)
  cheapestDate: { day: number; month: number; year: number; stay: number | null; airline?: string; dep_time?: string };
  typicalPrice?: number;
  discountVsTypical?: number; // pct off the typical price (informational)
  // Hermes 2026-09-29: timestamp sources so every card shows a "首次發現" label.
  // - firstDetected: stamped by the detail scanner when a drop is first seen
  // - pendingFirstSeen: stamped by the calendar scanner when a likely drop
  //   is first seen (no detail confirmation yet). Same field the old pending
  //   UI used. Falls back to this so typical-comparison rows also have a
  //   timestamp.
  firstDetected?: string | null;
  pendingFirstSeen?: string | null;
  // Hermes 2026-09-29: source of the oldPrice comparison.
  //   'yesterday' — oldPrice came from cheapestDates[].history.1d (real yesterday vs today)
  //   'typical'   — oldPrice is the destination's typicalPrice (no history baseline yet)
  // The UI uses this to label the $ diff correctly ("昨日" vs "比一般價").
  comparisonSource: 'yesterday' | 'typical';
}

// Hermes 2026-09-29: PendingRow removed — see note above buildDropList.
// Drop rows now cover everything (export-stamped + history-computed +
// typical-comparison fallback), so a separate "pending" type is unneeded.

// Hermes 2026-06-23: buildDropList now consumes the destination-level
// dropAmount/dropPct/dropPrice stamped onto each route by the scanner
// export (export_all_dates_*.py). That fixes the "PUS 2-day stuck alert"
// bug: the old code compared cheapestDates[0] (single date) to its own
// history.1d (single date's yesterday) instead of destination-level.
//
// Logic: if the export provided destination-level drop data, use it and
// show the route. Otherwise fall back to the single-date comparison so
// the page still works on legacy data.
// Hermes 2026-06-25: also compute destination-level drops client-side
// when the export didn't stamp them. This brings the deals page in sync
// with send_flight_report.py — both now show the same routes that have
// a real yesterday-vs-today drop at the destination level, not just the
// ones the export script happened to flag.
function computeDestLevelDrop(d: Deal): {
  oldPrice: number; newPrice: number; dropAmount: number; dropPct: number;
  cd: Deal['cheapestDates'][number] | undefined;
} | null {
  const dates = d.cheapestDates || [];
  if (dates.length === 0) return null;
  // Hermes 2026-07-20: match the new exporter logic. Per-date drops scoped to
  // TOP 5 cheapest dates; filter out non-drops (pct >= 0) BEFORE taking median.
  // The old `todayLow = min(all_dates_prices)` + `yestLow = min(all_dates_1d_baselines)`
  // formula produced fake drops by comparing different dates' prices.
  const top5 = dates.slice(0, 5);
  const perDateDrops: Array<{ pct: number; cd: typeof dates[number]; todayPrice: number; yestPrice: number }> = [];
  for (const cd of top5) {
    const h = cd.history as Record<string, { price?: number }> | undefined;
    const yestPrice = h?.['1d']?.price ?? 0;
    const todayPrice = cd.price;
    if (yestPrice > 0 && todayPrice > 0) {
      const pct = (todayPrice - yestPrice) / yestPrice * 100;
      perDateDrops.push({ pct, cd, todayPrice, yestPrice });
    }
  }
  if (perDateDrops.length === 0) return null;
  // Hermes 2026-07-20: filter out non-drops before median — otherwise median of
  // [(-8.3), 0, 0, 0, 0] = 0 hides real drops when only 1-2 of top 5 have a baseline.
  const realDrops = perDateDrops.filter((d) => d.pct < 0);
  let chosen: { pct: number; cd: typeof dates[number]; todayPrice: number; yestPrice: number };
  if (realDrops.length > 0) {
    const sorted = [...realDrops].sort((a, b) => a.pct - b.pct);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      const medianPct = (sorted[mid - 1].pct + sorted[mid].pct) / 2;
      // pick the entry closest to median
      chosen = sorted.reduce((best, cur) => Math.abs(cur.pct - medianPct) < Math.abs(best.pct - medianPct) ? cur : best);
    } else {
      chosen = sorted[mid];
    }
  } else {
    // All top-5 are unchanged — no real drop
    return null;
  }
  const { pct, todayPrice, yestPrice } = chosen;
  const dropAmount = yestPrice - todayPrice; // positive = drop
  if (dropAmount <= 0) return null;
  const dropPct = Math.round(pct * 10) / 10;
  return {
    oldPrice: yestPrice,
    newPrice: todayPrice,
    dropAmount,
    dropPct,
    cd: chosen.cd,
  };
}

function buildDropList(
  deals: Deal[],
  departure: Departure,
  cooldown?: Record<string, { amount: number | null; pct: number | null; price: number | null; ts: string | null }>,
): DropRow[] {
  const rows: DropRow[] = []
  for (const d of deals) {
    // Prefer destination-level drop stamped by the export.
    const expDropAmount = d.dropAmount;
    const expDropPct = d.dropPct;
    const expDropPrice = d.dropPrice;
    // Note: export uses signed-negative convention (dropAmount = -X means
    // a drop of X). Some older/legacy files use positive dropAmount. We
    // accept either as long as the sign tells us it's a real drop.
    const hasExportDrop = typeof expDropAmount === 'number'
      && typeof expDropPct === 'number'
      && expDropPrice != null
      && (
        (expDropAmount > 0 && expDropPct < 0)   // positive dropAmount + negative pct (legacy)
        || (expDropAmount < 0 && expDropPct < 0) // signed-negative (current convention)
      );

    let oldPrice = 0;
    let newPrice = 0;
    let dropAmount = 0;
    let dropPct = 0;
    let cd: Deal['cheapestDates'][number] | undefined;
    let computedFallback = false;
    // Hermes 2026-09-29: 持續跌價 source — when current data has no drop but
    // the Telegram cooldown shows a recent alert, mirror the last alert's
    // data on the card so the web and Telegram views agree. The cooldown
    // key for HKG is "HKG→CODE" (or with airline: "HKG→UO→CODE",
    // "UO:HKG→CODE"). ts within the last 24h keeps stale entries from
    // surfacing indefinitely. comparisonSource: 'cooldown' is the marker
    // the render code uses to pick the "持續跌價" badge.
    let cooldownSource: { amount: number; pct: number; price: number | null; ts: string } | null = null;
    if (cooldown && (!hasExportDrop || expDropAmount === 0)) {
      const code = d.destination?.code || '';
      const airline = (d.airline || '').replace(/^_/, '').toUpperCase();
      const bareName = d.destination?.name || '';
      const candidates = [
        airline ? `HKG→${airline}→${bareName}` : null,
        `HKG→${bareName}`,
        airline ? `${airline}:HKG→${bareName}` : null,
        `HKG→${code}`,
      ].filter((k): k is string => !!k);
      for (const key of candidates) {
        const c = cooldown[key];
        if (c && c.ts) {
          const ageMs = Date.now() - new Date(c.ts).getTime();
          if (ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1000) {
            // Prefer stamped fingerprint; fall back to ts-only so we can
            // still mark the row as 持續跌價.
            cooldownSource = {
              amount: typeof c.amount === 'number' ? c.amount : 0,
              pct: typeof c.pct === 'number' ? c.pct : 0,
              price: c.price,
              ts: c.ts,
            };
            break;
          }
        }
      }
    }

    if (hasExportDrop) {
      // Destination-level: today's lowest = expDropPrice, yesterday's
      // lowest = expDropPrice - expDropAmount (where dropAmount is
      // negative-signed, so oldPrice = expDropPrice + |expDropAmount|).
      cd = pickDisplayDate(d.cheapestDates, expDropPrice!);
      // Normalize to positive dropAmount = old - new.
      dropAmount = Math.abs(expDropAmount);
      oldPrice = expDropPrice! + dropAmount;
      newPrice = expDropPrice!;
      dropPct = Math.round((dropAmount / oldPrice) * 100);
    } else {
      // No stamped drop — compute it client-side from cheapestDates.
      // Same algorithm as send_flight_report.py so the deals page and
      // the Telegram alert show the same routes.
      const computed = computeDestLevelDrop(d);
      if (!computed) continue;
      cd = pickDisplayDate(d.cheapestDates, computed.newPrice) ?? computed.cd;
      oldPrice = computed.oldPrice;
      newPrice = computed.newPrice;
      dropAmount = computed.dropAmount;
      dropPct = computed.dropPct;
      computedFallback = true;
    }
    if (!cd) continue;
    // Drop below 1% is noise — same threshold as send_flight_report.py.
    // Hermes 2026-08-20: use Math.abs() because the fallback path returns
    // dropPct as signed-negative (e.g. -48.4 for a 48.4% drop), while the
    // export-stamped path normalizes to positive. Without abs(), the
    // fallback path always passes the < 1 check and gets skipped → drops
    // that the export missed (e.g. SZX→CMB) silently disappear from the page.
    if (Math.abs(dropPct) < 1) continue;

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
      firstDetected: d.firstDetected ?? null,
      pendingFirstSeen: d.pendingFirstSeen ?? null,
      // Hermes 2026-09-29: both export-stamped and computed-from-history paths
      // produce a "real yesterday vs today" comparison, so they share the same
      // source label. The 'typical' fallback is added below.
      comparisonSource: 'yesterday',
      _computedFallback: computedFallback,
    } as DropRow & { _computedFallback?: boolean });
  }

  // Hermes 2026-09-29: after collecting "real" drops (export-stamped +
  // history.1d-computable), backfill routes whose price is well below
  // typical but lack any history.1d baseline. Without this, 20-30 % of
  // routes would vanish once the pending section is removed (detail
  // scanner is gone, so pendingScans no longer transitions to confirmed).
  // We compare against typicalPrice and label the row accordingly so the
  // UI can show "比一般價平" instead of "昨日".
  const seenRoutes = new Set(rows.map((r) => r.route));
  for (const d of deals) {
    if (seenRoutes.has(d.route)) continue;
    const typical = d.typicalPrice || 0;
    const newPrice = d.price;
    if (typical <= 0 || newPrice <= 0) continue;
    const discountVsTypical = Math.round(((typical - newPrice) / typical) * 100);
    // Same threshold as the old PENDING_MIN_DISCOUNT_PCT (15 %). Below
    // this, the route isn't meaningfully cheap and shouldn't clutter the
    // list. Cheap-day routes with history will already have been caught
    // by the real-drop branch above.
    if (discountVsTypical < 15) continue;
    const dates = (d.cheapestDates || []).slice().sort((a, b) => (a.price || 99999) - (b.price || 99999));
    const cd = dates[0];
    if (!cd) continue;
    const f = cd.flight || undefined;
    const dropAmount = typical - newPrice;
    const dropPct = discountVsTypical;
    rows.push({
      route: d.route,
      destCode: d.destination.code,
      destName: d.destination.name,
      region: d.destination.region,
      departure,
      oldPrice: typical,
      newPrice,
      dropAmount,
      dropPct,
      cheapestDate: {
        day: cd.day, month: cd.month, year: cd.year,
        stay: cd.stay ?? null,
        airline: f?.airline, dep_time: f?.dep_time,
      },
      typicalPrice: typical,
      discountVsTypical,
      firstDetected: d.firstDetected ?? null,
      pendingFirstSeen: d.pendingFirstSeen ?? null,
      comparisonSource: 'typical',
      _computedFallback: true,
    } as DropRow & { _computedFallback?: boolean });
  }

  // Hermes 2026-09-29: 持續跌價 overrides — if a route has a recent
  // (≤24h) cooldown entry showing a real vs-yesterday drop, override
  // whatever source we picked (yesterday / typical) so the card shows
  // the same numbers the Telegram 持續跌價 section surfaces. Without
  // this, routes whose baseline has rebased to today's price would
  // drop to comparisonSource: 'typical' and show 比一般價 instead of
  // the alert the user just saw on Telegram.
  if (cooldown) {
    // Hermes 2026-09-29: build a name-based index once (rather than per-row
    // candidate generation) so we can match routes that don't carry an
    // airline field. The deal records export `cheapestDate.airline` as
    // undefined for many routes (e.g. HIJ has no flight metadata at all),
    // so the bot's "HKG→UO→廣島 (HIJ)" key can never be reconstructed from
    // the row alone — the lookup has to be fuzzy on destName.
    const cdByName = new Map<string, { entry: { amount: number | null; pct: number | null; price: number | null; ts: string | null }; ageMs: number }>();
    const nowMs = Date.now();
    for (const [key, c] of Object.entries(cooldown)) {
      if (!c?.ts) continue;
      const ageMs = nowMs - new Date(c.ts).getTime();
      if (ageMs < 0 || ageMs > 24 * 60 * 60 * 1000) continue;
      // Extract the destination name from the key. Bot keys look like:
      //   "HKG→UO→廣島 (HIJ)"     → "廣島 (HIJ)"
      //   "UO:HKG→廣島 (HIJ)"     → "廣島 (HIJ)"
      //   "HKG→廣島 (HIJ)"        → "廣島 (HIJ)"
      //   "HKG→HIJ"               → no parens, skip
      // Hermes 2026-09-29: the previous regex `/(?:^|→|:HKG→)([^→]+?)\s*\(.../`
      // failed to match `HKG→UO→廣島 (HIJ)` because [^→]+? can't span →, so
      // it tried to capture from position 0 (HKG) and then the rest failed.
      // Use a "find the last name+(CODE) at end of string" pattern instead:
      //   - `([^→\s]+(?:\s[^→\s]+)*)` captures non-→ tokens joined by spaces
      //     (works for "廣島" or "約翰內斯堡" — single or multi-word)
      //   - followed by optional space and `(CODE)` at end of string
      // Code-only keys like `HKG→HIJ` (no parens) correctly fail to match.
      const m = key.match(/([^→\s]+(?:\s[^→\s]+)*)\s*\(([A-Z]{3})\)\s*$/);
      if (!m) continue;
      const destName = `${m[1]} (${m[2]})`;
      // First match wins (so explicit-airline keys are preferred when
      // the same destName appears under multiple keys).
      if (!cdByName.has(destName)) {
        cdByName.set(destName, { entry: c, ageMs });
      }
    }
    for (const row of rows) {
      const destName = row.destName;
      const match = cdByName.get(destName);
      if (!match) continue;

      // Hermes 2026-09-29: cooldown entries may have null amount/pct/price
      // when the alert fired but the fingerprint wasn't captured (some
      // bot paths stamp ts-only). In that case, fall back to deriving the
      // drop from the route's typicalPrice vs current newPrice, which gives
      // us a real "持續跌價" display even without the historical fingerprint.
      // This matches what the Telegram section would compute today if it
      // re-ran against current prices — the "持續跌價" label still applies
      // because the user just got pinged about this route within the
      // COOLDOWN window.
      let absAmount: number;
      let absPct: number;
      const cdEntry = match.entry;
      if (typeof cdEntry.amount === 'number' && typeof cdEntry.pct === 'number'
          && cdEntry.amount !== 0 && cdEntry.pct !== 0) {
        absAmount = Math.abs(cdEntry.amount);
        absPct = Math.abs(Math.round(cdEntry.pct * 10) / 10);
      } else {
        // Fallback: derive from typicalPrice vs newPrice.
        const typical = row.typicalPrice || 0;
        if (typical > 0 && row.newPrice > 0 && typical > row.newPrice) {
          absAmount = typical - row.newPrice;
          absPct = Math.round((absAmount / typical) * 1000) / 10;
        } else {
          continue;  // No drop data available anywhere — leave row alone.
        }
      }
      // Override: use last-alerted dropAmount / dropPct / firstDetected.
      // We DON'T touch newPrice (current scanner price) so the price
      // shown stays accurate; we DO set oldPrice to newPrice + absAmount
      // so the strikethrough "yesterday" price renders correctly.
      row.dropAmount = absAmount;
      row.dropPct = absPct;
      row.oldPrice = row.newPrice + absAmount;
      row.firstDetected = cdEntry.ts;
      (row as DropRow & { _cooldownOverride?: boolean })._cooldownOverride = true;
    }
  }

  return rows;
}

// Hermes 2026-09-29: PendingRow + buildPendingList removed.
// The detail scanner no longer runs, so "pendingScans > 0" never transitions
// to confirmed — every route with a calendar-only drop would stay forever
// under ⏳ 掃描中. buildDropList now backfills those routes directly with
// comparisonSource: 'typical' so they appear in the main list with the
// correct "比一般價" label.

// Hermes 2026-06-23: pick the cheapest date that has flight info and
// matches (or is closest to) the displayed dropPrice. Without this, the
// card would show a flightless date for routes where the min-price date
// has no flight details, even when another date with the same price
// (or within a few HKD) has airline info.
function pickDisplayDate(
  dates: Deal['cheapestDates'],
  dropPrice: number,
): Deal['cheapestDates'][number] | undefined {
  if (!dates || dates.length === 0) return undefined;
  // Prefer a date whose price == dropPrice AND has flight info.
  for (const cd of dates) {
    if (cd.price === dropPrice && cd.flight) return cd;
  }
  // Otherwise prefer a date with flight info, nearest to dropPrice.
  const withFlight = dates.filter(cd => cd.flight);
  if (withFlight.length > 0) {
    return withFlight.reduce((best, cur) =>
      Math.abs(cur.price - dropPrice) < Math.abs(best.price - dropPrice) ? cur : best
    );
  }
  // Last resort: first date.
  return dates[0];
}

// Format an ISO timestamp into a friendly "N hours ago" / "Jun 23 09:14" label.
// Returns null if the input is null/invalid so the UI can render a placeholder.
function formatAlertTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const now = Date.now();
  const diffSec = Math.round((now - t) / 1000);
  if (diffSec < 0) {
    // Future timestamp (clock skew or just imported) → show absolute
    return new Date(t).toLocaleString('zh-HK', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
  if (diffSec < 60) return `${diffSec} 秒前`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分鐘前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小時前`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} 日前`;
  // Older than a week → show absolute date
  return new Date(t).toLocaleString('zh-HK', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
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

// Hermes 2026-07-01: airline name map for the multi-airline filter chips.
// Display full Chinese name when known; otherwise just show the IATA code.
const AIRLINE_NAMES: Record<string, string> = {
  'UO': '香港快運',
  'CX': '國泰',
  'KA': '國泰港龍',
  'HK': '港航',
  'HKE': '港航',
  'BX': '釜山航空',
  'KE': '大韓',
  'OZ': '韓亞',
  'NH': '全日空',
  'JL': '日航',
  'MM': '樂桃',
  'TR': '酷航',
  'AK': '亞航',
  'D7': 'AirAsia X',
  'VJ': '越捷',
  'AI': '印度航空',
  'SL': '獅航',
  'PR': '菲律賓航空',
  '5J': 'Cebu Pacific',
  'TG': '泰航',
  'UA': '聯合航空',
  'AC': '加拿大航空',
  'AA': '美國航空',
  'DL': '達美',
  'BR': '長榮',
  'CI': '中華',
  'EK': '阿聯酋',
  'EY': '阿提哈德',
  'QR': '卡塔爾',
  'TK': '土耳其航空',
  'BA': '英航',
  'AF': '法航',
  'KL': '荷航',
  'LH': '漢莎',
  'LX': '瑞航',
  'QF': '澳航',
  'BI': '汶萊皇家',
  'GK': '日航春秋',
  'SC': '山東航空',
  'HU': '海航',
  'CZ': '南航',
  'MU': '東航',
  'CA': '國航',
  'FM': '上航',
  'AY': '芬航',
  'KQ': '肯亞航空',
  'SK': '北歐航空',
};

function airlineLabel(code: string): string {
  const name = AIRLINE_NAMES[code];
  return name ? `${name} (${code})` : code;
}

export default function DealsPage() {
  const [departure, setDeparture] = useState<Departure>('HKG');
  const [sortMode, setSortMode] = useState<SortMode>('discount');
  // Hermes 2026-07-01: multi-airline filter. null = show all airlines.
  // When set to an IATA code (e.g. 'UO', 'CX'), only routes whose displayed
  // cheapest date is operated by that airline are shown. Replaces the
  // previous boolean uoOnly toggle with a chip row so the user can pick
  // any airline that currently has drops.
  const [airlineFilter, setAirlineFilter] = useState<string | null>(null);
  // Hermes: live data — fetch from /api/deals which proxies the NAS funnel
  // (60s in-memory cache). Avoids the Vercel static-prerender problem where
  // the bundled src/data/all_dates*.json can be hours stale.
  const [hkgDeals, setHkgDeals] = useState<Deal[]>([]);
  const [szxDeals, setSzxDeals] = useState<Deal[]>([]);
  // Hermes 2026-09-29: cooldown map from /api/deals — keyed by route_key
  // variants (HKG→CODE, HKG→UO→CODE, UO:HKG→CODE). Used to surface
  // 持續跌價 (持續跌價 = "still falling") entries where the current scanner
  // baseline has caught up but the last alert (≤24h old) showed a real drop.
  // Without this, the deals page would only show routes whose baseline
  // hasn't rebased yet — a strict subset of what the Telegram 持續跌價
  // section surfaces, so the two views disagree.
  const [hkgCooldown, setHkgCooldown] = useState<Record<string, { amount: number | null; pct: number | null; price: number | null; ts: string | null }>>({});
  const [szxCooldown, setSzxCooldown] = useState<Record<string, { amount: number | null; pct: number | null; price: number | null; ts: string | null }>>({});
  const [hkgGenerated, setHkgGenerated] = useState<string>('');
  const [szxGenerated, setSzxGenerated] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        // F-07 fix: no force=1 — the server-side 20s in-memory cache matches
        // the poll interval, so users always see fresh data without a bypass.
        const [hkgRes, szxRes] = await Promise.all([
          fetch('/api/deals?dep=HKG', { cache: 'no-store' }),
          fetch('/api/deals?dep=SZX', { cache: 'no-store' }),
        ]);
        if (!hkgRes.ok) throw new Error(`HKG fetch ${hkgRes.status}`);
        if (!szxRes.ok) throw new Error(`SZX fetch ${szxRes.status}`);
        const [hkgJson, szxJson] = await Promise.all([hkgRes.json(), szxRes.json()]);
        if (cancelled) return;
        setHkgDeals((hkgJson.results || []) as Deal[]);
        setSzxDeals((szxJson.results || []) as Deal[]);
        setHkgCooldown(hkgJson.cooldown || {});
        setSzxCooldown(szxJson.cooldown || {});
        setHkgGenerated(hkgJson.generated || '');
        setSzxGenerated(szxJson.generated || '');
      } catch (e) {
        if (!cancelled) setFetchError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    // Hermes 2026-07-09: dropped 90s → 20s so drops appear on the page within
    // ~30 s of the export cycle (was 5+ min). The /api/deals cache layer
    // already short-circuits redundant upstream fetches, so 20 s is cheap.
    const t = setInterval(load, 20_000);
    // Hermes 2026-07-09: also refresh on tab focus so a backgrounded tab gets
    // fresh data the moment the user opens the app — closes the "I just got
    // a Telegram alert but the page still shows yesterday's drops" gap.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Process both files once. Pass cooldown map so routes whose current
  // baseline caught up (dropAmount=0) but that have a recent alert can still
  // show the last-alerted drop data — matching the Telegram 📌 持續跌價 view.
  const hkgRows = useMemo(
    () => buildDropList(hkgDeals, 'HKG', hkgCooldown),
    [hkgDeals, hkgCooldown],
  );
  const szxRows = useMemo(
    () => buildDropList(szxDeals, 'SZX', szxCooldown),
    [szxDeals, szxCooldown],
  );

  const rows = departure === 'HKG' ? hkgRows : szxRows;
  const currentGenerated = departure === 'HKG' ? hkgGenerated : szxGenerated;

  const szxEmpty = szxRows.length === 0;

  // Compute the set of airlines that currently have at least one drop,
  // ordered by frequency (most-frequent first). Used to render the
  // multi-airline chip row.
  const airlineOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const code = (r.cheapestDate.airline || '').replace(/^_/, '').toUpperCase();
      if (!code || code === 'UNKNOWN') continue;
      counts.set(code, (counts.get(code) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);

  const renderedRows = useMemo(() => {
    let copy = [...rows];
    // Hermes 2026-07-01: multi-airline filter. When airlineFilter is set
    // (e.g. 'UO'), only routes whose displayed cheapest date is operated
    // by that airline are kept. Routes with no flight info are dropped
    // from any airline-filtered view (can't attribute them).
    if (airlineFilter) {
      copy = copy.filter(
        (r) => (r.cheapestDate.airline || '').replace(/^_/, '').toUpperCase() === airlineFilter
      );
    }
    if (sortMode === 'recency') {
      // Hermes 2026-09-29: include pendingFirstSeen in recency sort so the
      // "newest first" list still orders correctly now that most routes use
      // pendingFirstSeen instead of firstDetected.
      copy.sort((a, b) => {
        const ta = (a.firstDetected || a.pendingFirstSeen) ? Date.parse((a.firstDetected || a.pendingFirstSeen) as string) : -Infinity;
        const tb = (b.firstDetected || b.pendingFirstSeen) ? Date.parse((b.firstDetected || b.pendingFirstSeen) as string) : -Infinity;
        return tb - ta;
      });
    } else {
      copy.sort((a, b) => b.dropPct - a.dropPct);
    }
    return copy;
  }, [rows, sortMode, airlineFilter]);

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
        {/* Back button */}
        <div className="mb-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            返回主頁
          </Link>
        </div>

        {/* Header */}
        <div className="mb-4 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">🔥 今日劈價</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            對比昨日最低價 · 顯示實際跌價嘅航線 · 按跌幅 % 排序
          </p>
          {currentGenerated && (
            <p className="mt-1 text-xs text-muted-foreground/80 inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              最後更新：{formatAlertTime(currentGenerated) || currentGenerated.slice(0, 16).replace('T', ' ')}
            </p>
          )}
        </div>

        {/* Departure + sort tabs */}
        <div className="mb-6 flex flex-col sm:flex-row items-center justify-center gap-3">
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
          {/* Sort toggle — only meaningful when there are rows */}
          {renderedRows.length > 0 && (
            <div className="inline-flex rounded-lg border border-border bg-card p-1 gap-1">
              <button
                onClick={() => setSortMode('discount')}
                className={`px-3 py-2 rounded-md text-xs font-medium transition-all ${
                  sortMode === 'discount'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                title="按跌幅百分比由大到小"
              >
                🔥 最大跌幅
              </button>
              <button
                onClick={() => setSortMode('recency')}
                className={`px-3 py-2 rounded-md text-xs font-medium transition-all ${
                  sortMode === 'recency'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                title="按首次發現時間由新到舊"
              >
                🕒 最新
              </button>
            </div>
          )}
          {/* Hermes 2026-07-01: multi-airline filter as a dropdown. Replaces
              the previous chip-row layout (which got unwieldy with 10+
              airlines on the deals page). Same filter behavior as the home
              page — null = show all airlines, otherwise narrow to that
              airline's drops. */}
          {renderedRows.length > 0 && airlineOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="airline-filter-deals"
                className="text-sm text-muted-foreground shrink-0"
              >
                ✈️ 航空公司:
              </label>
              <select
                id="airline-filter-deals"
                value={airlineFilter ?? '__all__'}
                onChange={(e) =>
                  setAirlineFilter(
                    e.target.value === '__all__' ? null : e.target.value,
                  )
                }
                className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40 max-w-xs"
              >
                <option value="__all__">全部 ({rows.length})</option>
                {airlineOptions.map(([code, count]) => (
                  <option key={code} value={code}>
                    {airlineLabel(code)} ({code}) · {count}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Empty state for SZX */}
        {departure === 'SZX' && szxEmpty ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <div className="text-4xl mb-3">{loading ? '⏳' : '⏳'}</div>
              <p className="text-lg font-medium text-foreground">
                {fetchError ? '無法載入劈價數據' : loading ? '載入中…' : 'SZX 劈價數據準備中'}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                {fetchError
                  ? `錯誤：${fetchError}`
                  : loading
                    ? '從 NAS 取得最新價格中…'
                    : 'SZX 數據累積中，下一次更新後即可顯示劈價列表。'}
                {!loading && !fetchError && <><br />預計 1-2 日內可見數據。</>}
              </p>
              <div className="mt-4 text-xs text-muted-foreground">
                💡 HKG 已有 {hkgRows.length} 個劈價航線
              </div>
            </CardContent>
          </Card>
        ) : renderedRows.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <div className="text-4xl mb-3">{loading ? '⏳' : fetchError ? '⚠️' : '📈'}</div>
              <p className="text-lg font-medium text-foreground">
                {fetchError ? '無法載入劈價數據' : loading ? '載入中…' : '今日無劈價'}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                {fetchError
                  ? `錯誤：${fetchError}`
                  : loading
                    ? '從 NAS 取得最新價格中…'
                    : '所有航線價格都比昨日高或持平，無可顯示嘅劈價。'}
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

            {/* Hermes 2026-09-29: pending section removed. The detail scanner no
                longer runs, so "⏳ 掃描中" never transitions to confirmed.
                buildDropList backfills typical-comparison rows directly so all
                deals appear in the unified list below. */}

            {/* Drop list */}
            <div className="space-y-3">
              {renderedRows.map((r, idx) => {
                const h = heat(r.dropPct);
                const dateLabel = `${r.cheapestDate.year}年${r.cheapestDate.month}月${r.cheapestDate.day}日`;
                // Hermes 2026-09-29: prefer detail-scanner firstDetected,
                // fall back to calendar-scanner pendingFirstSeen so every
                // card shows a consistent "首次發現" timestamp.
                const detectedAt = r.firstDetected ?? r.pendingFirstSeen ?? null;
                const alertLabel = formatAlertTime(detectedAt);
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
                                {/* Hermes 2026-09-29: prominent $ drop vs yesterday.
                                    comparisonSource === 'yesterday' → show "昨日"
                                    label so the user sees this is real Y/D
                                    movement. 'typical' → fallback when no history
                                    baseline exists; label says "比一般價". */}
                                <div className="mt-1 flex items-center justify-end gap-1.5">
                                  <Badge className={`text-xs font-bold ${h.cls}`}>
                                    {r.comparisonSource === 'yesterday' ? '昨日' : '比一般價'}
                                    {' '}-${r.dropAmount.toLocaleString()}
                                    <span className="opacity-80"> · -{r.dropPct}%</span>
                                  </Badge>
                                </div>
                                {r.comparisonSource === 'yesterday' && r.discountVsTypical !== undefined && r.discountVsTypical > 0 && (
                                  <div className="text-[10px] text-muted-foreground mt-1">
                                    比一般價平 {r.discountVsTypical}%
                                  </div>
                                )}
                              </div>
                            </div>
                            {/* Hermes 2026-09-29: always render the alert-time row.
                                Previously the whole row was hidden when firstDetected
                                was null, leaving some cards without a timestamp.
                                Now we always show "首次發現：" + a fallback label so
                                every card looks consistent. */}
                            <div className="mt-2 pt-2 border-t border-border/50 flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {detectedAt ? (
                                <>
                                  首次發現：{alertLabel}
                                  <span className="text-muted-foreground/60 ml-1">
                                    ({new Date(detectedAt).toLocaleString('zh-HK', {
                                      month: 'numeric', day: 'numeric',
                                      hour: '2-digit', minute: '2-digit',
                                    })})
                                  </span>
                                </>
                              ) : (
                                <span className="text-muted-foreground/60">
                                  首次發現：等待首次掃描
                                </span>
                              )}
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
              * 「昨日」標記係由系統記錄嘅歷史價格直接比較 · 「比一般價」係同目的地典型價比較 · 頁面每 20 秒自動刷新
            </p>
          </>
        )}
      </div>
    </div>
  );
}
