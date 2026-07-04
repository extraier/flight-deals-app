'use client';

import { useState, useMemo, useEffect } from 'react';
import { useTheme } from 'next-themes';
import serenityData from '@/data/serenity_data.json';
import { STOCK_PROFILES } from '@/data/serenity_stock_profiles';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

interface Tweet {
  id: string;
  username: string;
  nickname: string;
  text: string;
  url: string;
  createdAt: string;
  displayTime: string;
  isRetweet: boolean;
  cashtags: string[];
  quotedTweet?: unknown;
}

interface TickerEntry {
  ticker: string;
  symbol: string;
  longName: string;
  exchange: string | null;
  currency: string;
  sector: string | null;
  relation: string | null;
  mention_date: string | null;
  mention_price: number | null;
  mention_price_source: string | null;
  current_price: number | null;
  return_pct: number | null;
  change: number | null;
  change_pct: number | null;
  day_high: number | null;
  day_low: number | null;
  previous_close: number | null;
  market_cap: number | null;
  pe_ttm: number | null;
  ps_ttm: number | null;
  weburl: string | null;
  logo: string | null;
  country: string | null;
  mention_count: number;
  tweet_ids: string[];
  stale: boolean;
}

interface Data {
  updated: string;
  source_updated_at: string;
  source_url: string;
  handle: string;
  nickname: string;
  posts: Tweet[];
  rankings: TickerEntry[];
  tickers: Record<string, TickerEntry>;
  stats: {
    tweets_total: number;
    tweets_with_cashtags: number;
    tickers_tracked: number;
    quotes_missing: number;
    mention_prices_curated: number;
    mention_prices_yahoo: number;
    mention_prices_carry: number;
    mention_prices_unresolved: number;
  };
}

const data = serenityData as unknown as Data;

// ──────────────────────────────────────────────────────────────────────────
// Helpers — same dark-mode color tokens as /trump
// ──────────────────────────────────────────────────────────────────────────

function card(isDark: boolean) {
  return isDark
    ? 'bg-zinc-900/50 border-zinc-700 hover:border-zinc-600'
    : 'bg-white border-zinc-200 hover:border-zinc-400 shadow-sm';
}
function textMuted(isDark: boolean) {
  return isDark ? 'text-zinc-400' : 'text-zinc-500';
}
function textFaint(isDark: boolean) {
  return isDark ? 'text-zinc-600' : 'text-zinc-400';
}
function bgSurface(isDark: boolean) {
  return isDark ? 'bg-zinc-800' : 'bg-zinc-100';
}
function bgHeader(isDark: boolean) {
  return isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-100 border-zinc-300';
}
function borderSubtle(isDark: boolean) {
  return isDark ? 'border-zinc-700' : 'border-zinc-200';
}

function ReturnPill({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-zinc-400">—</span>;
  const pos = pct > 0;
  return (
    <span className={`font-bold ${pos ? 'text-emerald-500' : pct < 0 ? 'text-red-500' : 'text-zinc-400'}`}>
      {pos ? '+' : ''}{pct.toFixed(2)}%
    </span>
  );
}

function ChangePill({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-zinc-400">—</span>;
  const pos = pct > 0;
  return (
    <span className={`text-xs font-medium ${pos ? 'text-emerald-500' : pct < 0 ? 'text-red-500' : 'text-zinc-400'}`}>
      {pos ? '↑' : '↓'}{Math.abs(pct).toFixed(2)}%
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Currency-aware price formatter
// ──────────────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  HKD: 'HK$',
  CNY: 'CN¥',
  JPY: '¥',
  KRW: '₩',
  GBP: '£',
  GBp: '', // Yahoo stores pence as e.g. 44.85 — render as "44.85 GBp"
  EUR: '€',
  SEK: 'kr',
};

function formatPrice(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const ccy = (currency || 'USD').toUpperCase();
  const symbol = CURRENCY_SYMBOL[ccy];
  const zeroDecimal = new Set(['KRW', 'JPY', 'VND', 'CLP', 'SEK']);
  const fractionDigits = zeroDecimal.has(ccy) ? 2 : 2;
  const num = value.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  // GBp → "<num> GBp"
  if (ccy === 'GBp') return `${num} GBp`;
  if (ccy === 'SEK') return `${num} kr`;
  return symbol ? `${symbol}${num}` : `${num} ${ccy}`;
}

/**
 * Render a price with the right symbol given the ticker. The trackserenity.com
 * /api/stocks sometimes reports LSE equities' currency as "GBP" but the price
 * is actually in pence (e.g. IQE @ 44.85 means 44.85p, not £44.85). Heuristic:
 * if exchange is LSE and currency is GBP, append "p" if no symbol prefix.
 */
function formatPriceForTicker(value: number | null | undefined, currency: string | null | undefined, exchange: string | null | undefined): string {
  if (value == null) return '—';
  const ccy = (currency || 'USD').toUpperCase();
  const exch = (exchange || '').toUpperCase();
  // Auto-detect pence for LSE if API reports GBP but value looks like pence
  if (ccy === 'GBP' && (exch.includes('LSE') || exch.includes('LONDON'))) {
    return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GBp`;
  }
  return formatPrice(value, ccy);
}

function formatMarketCap(value: number | null | undefined): string {
  if (value == null) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString()}`;
}

// Exchange abbreviations — trackserenity.com's "NASDAQ NMS - GLOBAL MARKET"
// is too long for a column. Map full names → ticker.
function shortExchange(exchange: string | null | undefined): string {
  if (!exchange) return '';
  const e = exchange.toUpperCase();
  if (e.includes('NASDAQ NMS') || e.includes('NASDAQ GLOBAL')) return 'NASDAQ';
  if (e.includes('NASDAQ')) return 'NASDAQ';
  if (e.includes('NYSE') || e.includes('NEW YORK STOCK')) return 'NYSE';
  if (e.includes('NMS')) return 'NASDAQ';
  if (e.includes('NGM')) return 'NASDAQ';
  if (e.includes('SHANGHAI') || e === 'SSE') return 'SSE';
  if (e.includes('SHENZHEN') || e === 'SZSE') return 'SZSE';
  if (e.includes('KRX') || e.includes('KOREA')) return 'KRX';
  if (e.includes('HKEX') || e.includes('HONG KONG')) return 'HKEX';
  if (e.includes('LSE') || e.includes('LONDON')) return 'LSE';
  if (e.includes('OMX') || e.includes('STOCKHOLM')) return 'OMX';
  if (e.includes('EURONEXT')) return 'EPA';
  if (e.includes('TOKYO')) return 'TYO';
  return e.split(/[ ,-]/)[0].slice(0, 8);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ──────────────────────────────────────────────────────────────────────────
// Tabs
// ──────────────────────────────────────────────────────────────────────────

type Tab = 'feed' | 'performance';

// ─── FEED ─────────────────────────────────────────────────────────────────

function TweetCard({ tweet, isDark }: { tweet: Tweet; isDark: boolean }) {
  const tickers = (tweet.cashtags || []).map((t) => String(t).toUpperCase()).filter(Boolean);
  const text = tweet.text || '';

  return (
    <div className={`border rounded-lg ${card(isDark)} overflow-hidden`}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold">{tweet.nickname || 'Serenity'}</span>
            <span className={`text-xs ${textFaint(isDark)}`}>@{tweet.username}</span>
            <span className={`text-xs ${textFaint(isDark)}`}>· {tweet.displayTime}</span>
          </div>
          <span className={`text-xs ${textFaint(isDark)}`}>#{tweet.id.slice(-6)}</span>
        </div>

        <p className={`text-sm leading-relaxed mb-2 whitespace-pre-wrap ${isDark ? 'text-zinc-100' : 'text-zinc-800'}`}>
          {text}
        </p>

        {tickers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tickers.map((t) => {
              const tkr = data.tickers[t];
              const cur = tkr?.current_price;
              const chg = tkr?.change_pct;
              return (
                <span
                  key={t}
                  className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border font-medium ${
                    isDark
                      ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                      : 'bg-cyan-50 text-cyan-700 border-cyan-300'
                  }`}
                >
                  <span className="font-bold">${t}</span>
                  {cur != null && (
                    <span className={textMuted(isDark)}>
                      {formatPriceForTicker(cur, tkr?.currency, tkr?.exchange)}
                    </span>
                  )}
                  {chg != null && <ChangePill pct={chg} />}
                </span>
              );
            })}
          </div>
        )}

        <a
          href={tweet.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:text-blue-300 mt-2 inline-block"
        >
          🔗 在 X 上查看 →
        </a>
      </div>
    </div>
  );
}

function FeedTab({ isDark }: { isDark: boolean }) {
  const [showAll, setShowAll] = useState(false);
  // Most recent first
  const sorted = useMemo(
    () => [...data.posts].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [],
  );
  const visible = showAll ? sorted : sorted.slice(0, 12);

  if (sorted.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-400">
        <div className="text-4xl mb-4">📭</div>
        <div>尚無 Serenity 推文</div>
        <div className={`text-sm mt-2 ${textFaint(isDark)}`}>
          Pipeline: node scripts/fetch-serenity-data.js
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map((t) => (
        <TweetCard key={t.id} tweet={t} isDark={isDark} />
      ))}
      {!showAll && sorted.length > 12 && (
        <button
          onClick={() => setShowAll(true)}
          className={`w-full py-3 text-sm ${isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          Show {sorted.length - 12} more tweets ↓
        </button>
      )}
    </div>
  );
}

// ─── PERFORMANCE ──────────────────────────────────────────────────────────

function PerformanceTab({ isDark }: { isDark: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const withReturn = data.rankings.filter((r) => r.return_pct != null);
  const withoutReturn = data.rankings.filter((r) => r.return_pct == null);
  const ranked = [...withReturn].sort((a, b) => (b.return_pct ?? 0) - (a.return_pct ?? 0));
  const visible = showAll ? ranked : ranked.slice(0, 25);

  if (ranked.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-400">
        <div className="text-4xl mb-4">📊</div>
        <div>暫無回報資料</div>
        <div className={`text-sm mt-2 ${textFaint(isDark)}`}>
          Mention-day prices 暫時無法解析（Yahoo API 限流中）
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header strip */}
      <div className="bg-gradient-to-r from-cyan-700 to-cyan-600 text-white px-4 py-2 rounded-lg mb-4 font-bold text-sm flex items-center justify-between">
        <span>📈 Serenity 持股回報排名</span>
        <span className="font-normal opacity-80 text-xs">
          {ranked.length} tickers · mention-date 起算
        </span>
      </div>

      <div className="overflow-x-auto" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className={`${bgSurface(isDark)} ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
              <th className="text-left p-3 rounded-tl-lg sticky top-0 z-10 bg-inherit">#</th>
              <th className="text-left p-3 sticky top-0 z-10 bg-inherit">Ticker</th>
              <th className="text-left p-3 sticky top-0 z-10 bg-inherit hidden sm:table-cell">Company</th>
              <th className="text-left p-3 sticky top-0 z-10 bg-inherit hidden md:table-cell">Mentioned</th>
              <th className="text-right p-3 sticky top-0 z-10 bg-inherit">Mention</th>
              <th className="text-right p-3 sticky top-0 z-10 bg-inherit">Current</th>
              <th className="text-right p-3 rounded-tr-lg sticky top-0 z-10 bg-inherit">Return</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr
                key={r.ticker}
                className={`border-b ${borderSubtle(isDark)} ${isDark ? 'hover:bg-zinc-800/50' : 'hover:bg-zinc-50'}`}
              >
                <td className={`p-3 ${textFaint(isDark)} font-mono`}>{i + 1}</td>
                <td className="p-3 font-bold">
                  <div>${r.ticker}</div>
                  <div className={`text-xs font-normal ${textFaint(isDark)}`}>{shortExchange(r.exchange)}</div>
                </td>
                <td className={`p-3 hidden sm:table-cell`}>
                  <div>{r.longName}</div>
                  {r.relation && (
                    <div className={`text-xs ${textFaint(isDark)} italic mt-0.5 line-clamp-1`} title={r.relation}>
                      {r.relation}
                    </div>
                  )}
                </td>
                <td className={`p-3 hidden md:table-cell ${textMuted(isDark)} text-xs`}>
                  {formatDate(r.mention_date)}
                </td>
                <td className="p-3 text-right font-mono text-xs">
                  {formatPriceForTicker(r.mention_price, r.currency, r.exchange)}
                </td>
                <td className="p-3 text-right font-mono">
                  <div>{formatPriceForTicker(r.current_price, r.currency, r.exchange)}</div>
                  {r.change_pct != null && (
                    <div className="text-xs"><ChangePill pct={r.change_pct} /></div>
                  )}
                </td>
                <td className="p-3 text-right"><ReturnPill pct={r.return_pct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!showAll && ranked.length > 25 && (
        <button
          onClick={() => setShowAll(true)}
          className={`w-full py-3 text-sm ${isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          Show {ranked.length - 25} more tickers ↓
        </button>
      )}

      {withoutReturn.length > 0 && (
        <details className={`mt-4 text-xs ${textMuted(isDark)}`}>
          <summary className="cursor-pointer">
            {withoutReturn.length} tickers awaiting mention-day price
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {withoutReturn.map((r) => (
              <span
                key={r.ticker}
                className={`px-2 py-0.5 rounded border ${borderSubtle(isDark)}`}
              >
                ${r.ticker}
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

export default function SerenityPage() {
  const [tab, setTab] = useState<Tab>('feed');
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted ? resolvedTheme === 'dark' : true;

  const updated = data.updated?.replace('T', ' ').slice(0, 16) || '';
  const sourceUpdated = data.source_updated_at?.replace('T', ' ').slice(0, 16) || '';

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className={`bg-gradient-to-r ${bgHeader(isDark)} px-6 py-8 border-b ${borderSubtle(isDark)}`}>
        <div className="max-w-5xl mx-auto">
          <h1 className={`text-3xl font-bold tracking-tight mb-1 ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>
            Serenity 持股追蹤
          </h1>
          <p className={`text-sm ${textMuted(isDark)}`}>
            追蹤 @{data.handle}（白毛股神）的推文中提及的股票，含即時報價與自首次提及以來的回報
          </p>
          <p className={`text-xs ${textFaint(isDark)} mt-1`}>
            更新時間 {updated} · 每15分鐘自動更新 · 數據源 {sourceUpdated}
          </p>
          {/* Quick stats */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
            <Stat label="追蹤 ticker" value={data.stats.tickers_tracked} isDark={isDark} />
            <Stat label="有回報" value={data.stats.mention_prices_curated + data.stats.mention_prices_yahoo + data.stats.mention_prices_carry} isDark={isDark} />
            <Stat label="總推文" value={data.stats.tweets_total} isDark={isDark} />
            <Stat label="提及 ticker 數" value={data.stats.tweets_with_cashtags} isDark={isDark} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className={`${bgSurface(isDark)} border-b ${borderSubtle(isDark)} px-6 py-3`}>
        <div className="max-w-5xl mx-auto flex gap-1">
          <button
            onClick={() => setTab('feed')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'feed'
                ? 'bg-cyan-600 text-white'
                : `${bgSurface(isDark)} ${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'}`
            }`}
          >
            📰 推文動態
          </button>
          <button
            onClick={() => setTab('performance')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'performance'
                ? 'bg-cyan-600 text-white'
                : `${bgSurface(isDark)} ${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'}`
            }`}
          >
            📈 持股回報
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        {tab === 'feed' ? <FeedTab isDark={isDark} /> : <PerformanceTab isDark={isDark} />}
      </div>

      {/* Footer */}
      <div className={`text-center text-xs py-6 border-t ${borderSubtle(isDark)} ${textFaint(isDark)}`}>
        數據來源：trackserenity.com (signals.json + /api/stocks) · Yahoo Finance · 純屬資訊整合，不構成投資建議 · 最後更新 {updated}
      </div>
    </div>
  );
}

function Stat({ label, value, isDark }: { label: string; value: number; isDark: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={`text-xl font-bold ${isDark ? 'text-cyan-400' : 'text-cyan-700'}`}>{value}</span>
      <span className={`text-xs ${textFaint(isDark)}`}>{label}</span>
    </div>
  );
}