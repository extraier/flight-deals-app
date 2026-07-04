/**
 * fetch-serenity-data.js
 *
 * Builds src/data/serenity_data.json — the data feed for /serenity page.
 *
 * Data sources (Hermes 2026-07-04):
 *   PRIMARY 1  trackserenity.com/data/signals.json
 *              → Serenity's recent tweets with $TICKER cashtags pre-extracted.
 *                Same data trackserenity.com renders. Updates every ~30 min.
 *   PRIMARY 2  trackserenity.com/api/stocks?symbols=…
 *              → Live price, change%, currency, day OHLC. Optional financials=1
 *                adds company profile + P/E + market cap. Unauthenticated.
 *                Used for the "Current Price" + "Today" columns.
 *   SECONDARY query1.finance.yahoo.com/v8/finance/chart/{symbol}
 *              → Historical OHLC for "Price When Mentioned" lookup.
 *                Best-effort — trackserenity.com doesn't expose this.
 *                On failure we carry forward the previous snapshot's
 *                mention_price so the return % stays stable.
 *
 * Output:
 *   src/data/serenity_data.json — same shape the page reads:
 *     { updated, source_updated_at, handle, nickname, posts, rankings, tickers, stats }
 *
 * Usage:
 *   node scripts/fetch-serenity-data.js
 *
 * Cron: every 15 min via Vercel Cron (cheap) or NAS crontab.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SIGNALS_URL = 'https://www.trackserenity.com/data/signals.json';
const STOCKS_BASE = 'https://www.trackserenity.com/api/stocks';
const SCRIPT_URL = 'https://www.trackserenity.com/script.js?v=x-feed-18';
const PROFILES_PATH = path.join(ROOT, 'src', 'data', 'serenity_stock_profiles.json');
const TRANSLATIONS_PATH = path.join(ROOT, 'src', 'data', 'serenity_translations.json');
const OUT_PATH = path.join(ROOT, 'src', 'data', 'serenity_data.json');
const TMP_PATH = OUT_PATH + '.tmp';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const HEADERS = { 'User-Agent': UA, Accept: 'application/json' };

// Yahoo symbol suffix for non-US tickers. Serenity mostly mentions US tickers
// plus a couple of CN codes. The rule:
//   6 digits starting with 0/3 → Shenzhen (.SZ)
//   6 digits starting with 6    → Shanghai (.SS)
//   4-5 digits starting with 0  → could be HK (.HK) — none in current feed
//   everything else             → bare ticker (US works as-is)
function withSuffix(ticker) {
  const t = ticker.toUpperCase();
  if (/^\d{6}$/.test(t)) return t.startsWith('6') ? `${t}.SS` : `${t}.SZ`;
  if (/^0\d{3,4}$/.test(t)) return `${t}.HK`;
  return t;
}

// Common English words that show up as $TICKER in tweets but aren't real tickers.
// Keep small — if Serenity uses one of these we'll see it ranked with a 0% return.
const NOISE_TICKERS = new Set([
  'IPO', 'CEO', 'CFO', 'AI', 'ETF', 'USA', 'USD', 'EU', 'GDP',
  'CTO', 'COO', 'HTTP', 'HTTPS', 'SEC', 'CPI', 'FED', 'YOY', 'QOQ', 'MOM',
]);

// ──────────────────────────────────────────────────────────────────────────
// HTTP
// ──────────────────────────────────────────────────────────────────────────

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { headers: HEADERS, ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchJsonSoft(url) {
  try {
    return await fetchJson(url);
  } catch (err) {
    console.warn(`[soft fail] ${url} → ${err.message}`);
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ──────────────────────────────────────────────────────────────────────────
// Source 1: signals.json
// ──────────────────────────────────────────────────────────────────────────

async function loadSignals() {
  return fetchJson(SIGNALS_URL);
}

/** Parse Twitter-style "Fri Jul 03 06:53:07 +0000 2026" → ISO 8601 string. */
function parseTwitterDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ──────────────────────────────────────────────────────────────────────────
// Source 2: trackserenity.com /api/stocks
// ──────────────────────────────────────────────────────────────────────────

/**
 * Fetch live quotes for a batch of symbols (trackserenity.com caps batches
 * to ~50 symbols per request based on observed behavior). Returns a map
 * { SYMBOL: { price, change, changePercent, currency, dayHigh, dayLow, open,
 *              previousClose, source, marketSymbol, company, metrics, ... } }
 * or {} on error.
 */
async function fetchLiveQuotes(symbols) {
  if (symbols.length === 0) return {};
  const url = `${STOCKS_BASE}?symbols=${encodeURIComponent(symbols.join(','))}&financials=1`;
  const data = await fetchJsonSoft(url);
  return data?.quotes ?? {};
}

// ──────────────────────────────────────────────────────────────────────────
// Source 3: Yahoo Finance chart (mention-day price lookup, best-effort)
// ──────────────────────────────────────────────────────────────────────────

async function yahooChart(symbol, range = '1y', interval = '1d') {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,
      { headers: HEADERS },
    );
    if (res.status === 429) {
      console.warn(`[yahoo 429] ${symbol} — skipping`);
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    return {
      timestamps: result.timestamp || [],
      open: result.indicators?.quote?.[0]?.open || [],
    };
  } catch {
    return null;
  }
}

/** Open price on or before a YYYY-MM-DD target. */
function priceOnOrBefore(chart, yyyyMmDd) {
  const target = Math.floor(new Date(yyyyMmDd + 'T00:00:00Z').getTime() / 1000);
  const { timestamps: ts, open: op } = chart;
  for (let i = ts.length - 1; i >= 0; i--) {
    if (ts[i] != null && ts[i] <= target && op[i] != null) {
      return { ts: ts[i], open: op[i] };
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Carry-forward from prior snapshot (graceful degradation)
// ──────────────────────────────────────────────────────────────────────────

function loadPrior() {
  try {
    if (fs.existsSync(OUT_PATH)) return JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  } catch {}
  return null;
}

function loadCurated() {
  try {
    if (fs.existsSync(PROFILES_PATH)) return JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
  } catch (err) {
    console.warn(`[serenity] could not load curated profiles: ${err.message}`);
  }
  return {};
}

function loadTranslations() {
  try {
    if (fs.existsSync(TRANSLATIONS_PATH)) return JSON.parse(fs.readFileSync(TRANSLATIONS_PATH, 'utf8'));
  } catch (err) {
    console.warn(`[serenity] could not load translations: ${err.message}`);
  }
  return {};
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  console.log('[serenity] loading signals.json...');

  const signals = await loadSignals();
  const tweets = signals.tweets || [];
  const sources = signals.sources || [];
  console.log(`[serenity] updated=${signals.updatedAt} tweets=${tweets.length}`);

  // Index tickers: TICKER → { firstDate, lastDate, lastDisplayTime, ids:Set }
  const tickerIndex = new Map();
  for (const tw of tweets) {
    const isoDate = parseTwitterDate(tw.createdAt);
    const dateStr = isoDate?.slice(0, 10);
    const displayTime = tw.displayTime || '';
    for (const raw of tw.cashtags || []) {
      const t = String(raw).toUpperCase().trim();
      if (!t || NOISE_TICKERS.has(t)) continue;
      const cur = tickerIndex.get(t) || { firstDate: dateStr, lastDate: dateStr, lastDisplayTime: displayTime, ids: new Set() };
      if (dateStr && (!cur.firstDate || dateStr < cur.firstDate)) cur.firstDate = dateStr;
      if (dateStr && dateStr > cur.lastDate) {
        cur.lastDate = dateStr;
        cur.lastDisplayTime = displayTime;
      }
      cur.ids.add(tw.id);
      tickerIndex.set(t, cur);
    }
  }
  console.log(`[serenity] unique tickers: ${tickerIndex.size}`);

  // Prior snapshot for carry-forward
  const prior = loadPrior();
  if (prior?.tickers) {
    console.log(`[serenity] prior snapshot: ${Object.keys(prior.tickers).length} tickers from ${prior.updated}`);
  }

  // Curated stockProfiles (from serenity_stock_profiles.json) — primary
  // source for mention-date + mention-price. Same data trackserenity.com
  // renders, including the human-written "relation" notes.
  const curated = loadCurated();
  console.log(`[serenity] curated profiles: ${Object.keys(curated).length} tickers`);

  // Hand-written 繁體中文 translations (id → text_cn). Optional — if missing,
  // tweets still render fine without the translation box. Sourced from
  // src/data/serenity_translations.json, regenerated by the translate workflow.
  const translations = loadTranslations();
  console.log(`[serenity] translations: ${Object.keys(translations).length} tweets`);

  // Sort: US tickers first, CN/HK last. Trackserenity's /api/stocks handles
  // both, but US is more reliable.
  const tickerEntries = [...tickerIndex.entries()].sort(([a], [b]) => {
    const aCN = /^\d{6}$/.test(a) ? 1 : 0;
    const bCN = /^\d{6}$/.test(b) ? 1 : 0;
    return aCN - bCN;
  });

  // ─── Step 1: live quotes from trackserenity.com (batch up to 50) ───
  console.log('[serenity] fetching live quotes from trackserenity.com...');
  const allSymbols = tickerEntries.map(([t]) => t);
  const liveQuotes = await fetchLiveQuotes(allSymbols);
  console.log(`[serenity] got live quotes for ${Object.keys(liveQuotes).length}/${allSymbols.length} symbols`);

  // ─── Step 2: mention-day prices ───
  // Source-of-truth order:
  //   1) Curated serenity_stock_profiles.json (matches what trackserenity.com shows)
  //   2) Yahoo Finance chart (for tickers not curated) — best-effort
  //   3) Carry-forward from prior snapshot
  console.log('[serenity] resolving mention prices (curated → yahoo → carry-forward)...');
  const mentionPrices = new Map(); // TICKER → { price, date, source }
  let mpYahooFails = 0;
  let mpFromCurated = 0;
  let mpFromYahoo = 0;
  let mpFromCarry = 0;
  for (const [ticker, info] of tickerEntries) {
    // 1) Curated
    const cur = curated[ticker];
    if (cur?.mentionPrice != null && cur?.mentionDate) {
      mentionPrices.set(ticker, { price: cur.mentionPrice, date: cur.mentionDate, source: 'curated' });
      mpFromCurated++;
      continue;
    }
    // 2) Yahoo
    if (info.firstDate) {
      const yahooSym = withSuffix(ticker);
      const chart = await yahooChart(yahooSym, '1y', '1d');
      if (chart) {
        const hit = priceOnOrBefore(chart, info.firstDate);
        if (hit) {
          mentionPrices.set(ticker, { price: hit.open, date: info.firstDate, source: 'yahoo' });
          mpFromYahoo++;
          await sleep(80);
          continue;
        }
      }
    }
    // 3) Carry-forward
    const old = prior?.tickers?.[ticker];
    if (old?.mention_price != null) {
      mentionPrices.set(ticker, { price: old.mention_price, date: old.mention_date, source: 'carry', stale: true });
      mpFromCarry++;
    } else {
      mpYahooFails++;
    }
  }
  console.log(`[serenity] mention prices: ${mentionPrices.size} (curated=${mpFromCurated} yahoo=${mpFromYahoo} carry=${mpFromCarry} unresolved=${mpYahooFails})`);

  // ─── Step 3: assemble tickers + rankings ───
  const tickersOut = {};
  const rankings = [];
  let quotesMissing = 0;

  for (const [ticker, info] of tickerEntries) {
    const quote = liveQuotes[ticker] || null;
    const mention = mentionPrices.get(ticker) || null;
    const priorT = prior?.tickers?.[ticker];
    const cur = curated[ticker] || null;

    // Carry-forward for live price too, if trackserenity.com didn't return one
    let currentPrice = quote?.price;
    let change = quote?.change;
    let changePct = quote?.changePercent;
    let priceStale = false;
    if (currentPrice == null && priorT?.current_price != null) {
      currentPrice = priorT.current_price;
      change = priorT.change;
      changePct = priorT.change_pct;
      priceStale = true;
    }

    if (currentPrice == null && mention?.price == null) {
      // No live AND no mention → skip entirely
      quotesMissing++;
      continue;
    }

    // Currency preference order:
//   1) Trackserenity.com's reported currency (authoritative, matches the price)
//   2) Inferred from curated exchange (KRX → KRW, SSE → CNY, SZSE → CNY, LSE → GBp)
//   3) Prior snapshot (carry-forward)
//   4) USD fallback
function inferCurrencyFromExchange(exchange) {
  if (!exchange) return null;
  const e = exchange.toUpperCase();
  if (e.includes('KRX')) return 'KRW';
  if (e.includes('SSE') || e.includes('SHANGHAI')) return 'CNY';
  if (e.includes('SZSE') || e.includes('SHENZHEN')) return 'CNY';
  if (e.includes('LSE') || e.includes('LONDON')) return 'GBp';
  if (e.includes('OMX') || e.includes('STOCKHOLM')) return 'SEK';
  if (e.includes('EURONEXT')) return 'EUR';
  if (e.includes('HKEX') || e.includes('HONG KONG')) return 'HKD';
  if (e.includes('NASDAQ') || e.includes('NYSE') || e.includes('NMS') || e.includes('NGM')) return 'USD';
  return null;
}
const currency = quote?.currency
  || inferCurrencyFromExchange(cur?.exchange)
  || inferCurrencyFromExchange(priorT?.exchange)
  || priorT?.currency
  || 'USD';
    const mentionDate = mention?.date || info.firstDate;
    const mentionPrice = mention?.price ?? priorT?.mention_price ?? null;
    const ret = mentionPrice != null && currentPrice != null
      ? ((currentPrice - mentionPrice) / mentionPrice) * 100
      : null;

    // Company metadata (trackserenity.com + curated profiles)
    const company = quote?.company?.profile || null;
    const metrics = quote?.company?.metrics || null;
    const longName = company?.name || cur?.name || quote?.symbol || priorT?.longName || ticker;
    const sector = company?.finnhubIndustry || cur?.sector || priorT?.sector || null;
    const exchange = company?.exchange || cur?.exchange || quote?.marketSymbol || priorT?.exchange || null;
    const relation = cur?.relation || null;

    const entry = {
      ticker,
      symbol: quote?.symbol || priorT?.symbol || ticker,
      longName,
      shortName: priorT?.shortName || longName,
      exchange,
      currency,
      sector,
      relation,
      first_mentioned_at: info.firstDate ? `${info.firstDate}T00:00:00Z` : null,
      last_mentioned_at: info.lastDate ? `${info.lastDate}T00:00:00Z` : null,
      last_display_time: info.lastDisplayTime,
      mention_date: mentionDate,
      mention_price: mentionPrice,
      mention_price_source: mention?.source || null,
      current_price: currentPrice,
      return_pct: ret,
      change,
      change_pct: changePct,
      day_high: quote?.dayHigh,
      day_low: quote?.dayLow,
      previous_close: quote?.previousClose,
      market_cap: metrics?.marketCapitalization ?? null,
      pe_ttm: metrics?.peTtm ?? null,
      ps_ttm: metrics?.psTtm ?? null,
      weburl: company?.weburl ?? null,
      logo: company?.logo ?? null,
      country: company?.country ?? null,
      ipo: company?.ipo ?? null,
      mention_count: info.ids.size,
      tweet_ids: [...info.ids],
      stale: priceStale || mention?.stale || false,
    };
    tickersOut[ticker] = entry;
    rankings.push(entry);
  }

  rankings.sort((a, b) => (b.return_pct ?? -Infinity) - (a.return_pct ?? -Infinity));

  const out = {
    updated: new Date().toISOString(),
    source_updated_at: signals.updatedAt,
    source_url: SIGNALS_URL,
    handle: sources[0]?.username || 'aleabitoreddit',
    nickname: sources[0]?.nickname || 'Serenity',
    posts: tweets,
    rankings,
    tickers: tickersOut,
    stats: {
      tweets_total: tweets.length,
      tweets_with_cashtags: tweets.filter((t) => t.cashtags?.length > 0).length,
      tickers_tracked: rankings.length,
      quotes_missing: quotesMissing,
      mention_prices_unresolved: mpYahooFails,
      mention_prices_curated: mpFromCurated,
      mention_prices_yahoo: mpFromYahoo,
      mention_prices_carry: mpFromCarry,
      translations_covered: Object.keys(translations).length,
    },
    translations,
  };

  fs.writeFileSync(TMP_PATH, JSON.stringify(out, null, 2));
  fs.renameSync(TMP_PATH, OUT_PATH);

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[serenity] wrote ${OUT_PATH}`);
  console.log(`[serenity] rankings: ${rankings.length} (quotes missing: ${quotesMissing})`);
  rankings.slice(0, 5).forEach((r, i) =>
    console.log(`  #${i + 1} $${r.ticker} ${r.longName} ${r.return_pct?.toFixed(2) ?? '—'}%`),
  );
  console.log(`[serenity] done in ${dt}s`);
}

main().catch((err) => {
  console.error('[serenity] FATAL', err);
  process.exit(1);
});