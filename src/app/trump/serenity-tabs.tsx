'use client';

// Serenity推文 (tweet feed) and Serenity持股 (performance ranking) tabs.
// Extracted from the former /serenity page so all Serenity content now
// lives inline alongside the Trump-era tabs on /trump.
//
// Hermes 2026-11-04: the data now arrives at RUNTIME from /api/serenity
// instead of a static `import serenityData from '@/data/serenity_data.json'`.
//
// WHY
// ---
// A static import is baked into the Next.js bundle at BUILD time. The
// Serenity sync job refreshes serenity_data.json every 6 hours and
// pushes it to the NAS, but the running app kept serving whatever JSON
// was in the bundle when it was last built -- the live page was showing
// a 2026-08-23 snapshot while the fresh file sat unused on disk.
//
// The bundled import is retained ONLY as the initial value so the tabs
// render real content instantly (no flash of empty state) before the
// fetch resolves, and so they still work if the API is unreachable.

import { useState, useEffect, useMemo } from 'react';
import serenityData from '@/data/serenity_data.json';

// ──────────────────────────────────────────────────────────────────────────
// Types (mirrored from the former /serenity/page.tsx)
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
  text_cn?: string;
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

export interface SerenityData {
  updated: string;
  source_updated_at: string;
  source_url: string;
  handle: string;
  nickname: string;
  posts: Tweet[];
  rankings: TickerEntry[];
  tickers: Record<string, TickerEntry>;
  translations: Record<string, string>;
  stats: {
    tweets_total: number;
    tweets_with_cashtags: number;
    tickers_tracked: number;
    quotes_missing: number;
    mention_prices_curated: number;
    mention_prices_yahoo: number;
    mention_prices_carry: number;
    mention_prices_unresolved: number;
    translations_covered: number;
  };
}

// Bundled copy — the initial value only. Live data arrives from
// /api/serenity within a second.
const BUNDLED = serenityData as unknown as SerenityData;

/**
 * Load Serenity data at runtime.
 *
 * Hermes 2026-11-04: fetch from /api/serenity, which reads the file from
 * disk on the NAS at request time. Falls back to the bundled copy if the
 * API is unreachable, so the tabs always render something.
 */
export function useSerenityData(): SerenityData {
  const [data, setData] = useState<SerenityData>(BUNDLED);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/serenity', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as SerenityData;
        if (cancelled) return;
        if (json && Array.isArray(json.posts)) setData(json);
      } catch {
        // Keep the bundled copy — the tabs still work, just less fresh.
      }
    }

    Promise.resolve().then(() => {
      load();
    });
    // The Serenity sync job runs every 6 hours; a 5-minute poll is plenty.
    const t = setInterval(() => load(), 5 * 60_000);
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

  return data;
}

// ──────────────────────────────────────────────────────────────────────────
// Shared style helpers — kept in sync with /trump/page.tsx helpers
// (we duplicate them here so this file is self-contained and doesn't
// require refactoring the Trump tabs as well).
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
    <span className={`text-xs font-medium ${pos ? 'text-emerald-500' : 'text-red-500'}`}>
      {pos ? '↑' : '↓'}{Math.abs(pct).toFixed(2)}%
    </span>
  );
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  HKD: 'HK$',
  CNY: 'CN¥',
  JPY: '¥',
  KRW: '₩',
  GBP: '£',
  GBp: '',
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
  if (ccy === 'GBp') return `${num} GBp`;
  if (ccy === 'SEK') return `${num} kr`;
  return symbol ? `${symbol}${num}` : `${num} ${ccy}`;
}

function formatPriceForTicker(value: number | null | undefined, currency: string | null | undefined, exchange: string | null | undefined): string {
  if (value == null) return '—';
  const ccy = (currency || 'USD').toUpperCase();
  const exch = (exchange || '').toUpperCase();
  if (ccy === 'GBP' && (exch.includes('LSE') || exch.includes('LONDON'))) {
    return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GBp`;
  }
  return formatPrice(value, ccy);
}

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
// 📰 Serenity推文 — Tweet feed
// ──────────────────────────────────────────────────────────────────────────

/**
 * Hermes 2026-11-04: parse a tweet timestamp to epoch millis.
 *
 * The upstream feed mixes two timestamp formats for the SAME field:
 *   - Twitter's old style: 'Tue Nov 03 05:49:56 +0000 2026'
 *   - ISO 8601:             '2026-11-02T14:15:50.000Z'
 *
 * The old code sorted with `(b.createdAt || '').localeCompare(a.createdAt
 * || '')` — a plain STRING comparison. That silently ordered the feed by
 * WEEKDAY NAME ('Mon' < 'Sat' < 'Tue' < 'Wed'), not by date, so the
 * newest tweets were buried: the genuinely newest post ranked 62nd out
 * of 80 and the top of the feed showed a week-old tweet.
 *
 * `Date.parse` handles both formats, so normalise through it.
 */
function tweetTime(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Hermes 2026-11-04: format a tweet timestamp as HKT 'YYYY-MM-DD HH:MM'.
 *
 * `displayTime` from the upstream is inconsistent too — some tweets carry
 * an already-formatted HKT string ('2026-11-02 22:15'), others carry the
 * raw Twitter string ('Tue Nov 03 05:49:56 +0000 2026'). Formatting both
 * through the same path makes every card in the feed consistent.
 */
function formatTweetTime(iso: string | null | undefined): string {
  const ms = tweetTime(iso);
  if (!ms) return '';
  // HKT is UTC+8 — shift, then read UTC fields.
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  );
}

function TweetCard({ tweet, isDark, tickers }: { tweet: Tweet; isDark: boolean; tickers: Record<string, TickerEntry> }) {
  const cashtags = (tweet.cashtags || []).map((t) => String(t).toUpperCase()).filter(Boolean);
  const text = tweet.text || '';
  const textCn = tweet.text_cn || null;
  // Hermes 2026-11-04: derive the timestamp from createdAt so every card
  // shows the same 'YYYY-MM-DD HH:MM' (HKT) format.
  const displayTime = formatTweetTime(tweet.createdAt) || tweet.displayTime || '';

  return (
    <div className={`border rounded-lg ${card(isDark)} overflow-hidden`}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold">{tweet.nickname || 'Serenity'}</span>
            <span className={`text-xs ${textFaint(isDark)}`}>@{tweet.username}</span>
            <span className={`text-xs ${textFaint(isDark)}`}>· {displayTime}</span>
          </div>
          <span className={`text-xs ${textFaint(isDark)}`}>#{tweet.id.slice(-6)}</span>
        </div>

        <p className={`text-sm leading-relaxed whitespace-pre-wrap ${isDark ? 'text-zinc-100' : 'text-zinc-800'}`}>
          {text}
        </p>

        {textCn && (
          <div className={`mt-3 pt-3 border-t ${borderSubtle(isDark)}`}>
            <div className="text-xs text-emerald-500 mb-1 font-medium">🇭🇰 粵語/繁體中文翻譯</div>
            <p className={`text-sm leading-relaxed whitespace-pre-wrap ${isDark ? 'text-zinc-300' : 'text-zinc-600'}`}>{textCn}</p>
          </div>
        )}

        {cashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {cashtags.map((t) => {
              const tkr = tickers[t];
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

export function SerenityFeedTab({ isDark }: { isDark: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const data = useSerenityData();
  const sorted = useMemo(
    // Hermes 2026-11-04: sort by PARSED timestamp, not by string. The
    // upstream mixes 'Tue Nov 03 05:49:56 +0000 2026' and ISO 8601 in
    // the same field, so a localeCompare sorted by weekday name and
    // buried the newest tweets (the newest post ranked 62/80).
    () => [...data.posts].sort((a, b) => tweetTime(b.createdAt) - tweetTime(a.createdAt)),
    [data.posts],
  );
  const visible = showAll ? sorted : sorted.slice(0, 12);
  const decorated = useMemo(
    () =>
      visible.map((t) => ({
        ...t,
        text_cn: t.text_cn || data.translations?.[t.id] || undefined,
      })),
    [visible, data.translations],
  );

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
      {decorated.map((t) => (
        <TweetCard key={t.id} tweet={t} isDark={isDark} tickers={data.tickers} />
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

// ──────────────────────────────────────────────────────────────────────────
// 📈 Serenity持股 — Performance ranking table
// ──────────────────────────────────────────────────────────────────────────

export function SerenityPerformanceTab({ isDark }: { isDark: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const data = useSerenityData();
  // Hermes 2026-07-27: show ALL tickers, even those without mention-day price.
  // Sort: latest mention first (mention_date desc).
  const ranked = useMemo(
    () =>
      [...data.rankings].sort((a, b) => {
        return (b.mention_date ?? '').localeCompare(a.mention_date ?? '');
      }),
    [data.rankings],
  );
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
      <div className="bg-gradient-to-r from-cyan-700 to-cyan-600 text-white px-4 py-2 rounded-lg mb-4 font-bold text-sm flex items-center justify-between">
        <span>📈 Serenity 持股列表</span>
        <span className="font-normal opacity-80 text-xs">
          {ranked.length} tickers · 最新的提咩先
        </span>
      </div>

      <div className="overflow-x-auto" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className={`${bgSurface(isDark)} text-${isDark ? 'zinc-300' : 'zinc-700'}`}>
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
                <td className="p-3 hidden sm:table-cell">
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
    </div>
  );
}
