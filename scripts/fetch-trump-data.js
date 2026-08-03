/**
 * fetch-trump-data.js
 *
 * Builds src/data/trump_alerts.json — data feed for /trump page
 * (📱 Truth Social + 📊 Trump 持股交易 tabs).
 *
 * Data sources (Hermes 2026-07-27, replacing the broken NAS-Playwright pipeline):
 *   PRIMARY 1  trumpstruth.org/feed                  → RSS feed for Truth Social posts
 *              No Playwright / no NAS container needed. Updates ~ daily.
 *              For each post, GET trumpstruth.org/statuses/{id} → scrape image.
 *   PRIMARY 2  quiverquant.com/Donald-Trump-Stock-Trades/  → Page HTML with
 *              `trumpTradesData` JS variable containing full trade history.
 *              No Playwright needed — Hermes parses the JS literal directly.
 *
 * What was here before (now removed):
 *   - The original sync_trump.sh called the NAS Playwright container `fli-scanner`
 *     at /data/scrape_quiverquant.py and fetched from localhost:8892/alerts.
 *   - fli-scanner died with OOM (exit 137) on 2026-07-11. The container never
 *     came back. The 8892 alerts HTTP endpoint died with it. /trump data froze
 *     at 2026-06-22 13:28 (the last entry before the OOM).
 *   - Vercel Hobby = 100 deploys/day budget means we don't auto-push either.
 *     We ONLY refresh src/data/trump_alerts.json locally. The next code deploy
 *     brings it online.
 *
 * Usage:
 *   node scripts/fetch-trump-data.js
 *
 * Cron: every 30 min via Vercel Cron (cheap) or NAS / Mac launchd.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { translateBatch } from './lib/translate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const FEED_URL = 'https://www.trumpstruth.org/feed';
const STATUS_URL = (id) => `https://www.trumpstruth.org/statuses/${id}`;
const QUIVER_URL = 'https://www.quiverquant.com/Donald-Trump-Stock-Trades/';

const OUT_PATH = path.join(ROOT, 'src', 'data', 'trump_alerts.json');
const TMP_PATH = OUT_PATH + '.tmp';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const HEADERS = { 'User-Agent': UA, Accept: '*/*' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRIOR_PATH = OUT_PATH;

function loadPrior() {
  try {
    if (fs.existsSync(PRIOR_PATH)) return JSON.parse(fs.readFileSync(PRIOR_PATH, 'utf8'));
  } catch {}
  return null;
}

// ──────────────────────────────────────────────────────────────
// Source 1: trumpstruth.org RSS feed (Truth Social posts)
// ──────────────────────────────────────────────────────────────

async function fetchRSS() {
  const res = await fetch(FEED_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
  return res.text();
}

/**
 * Parse an RSS-2.0 channel. Returns [{ id, link, text, date, guid }].
 * Handles escaped CDATA inside <description>.
 */
function parseRSS(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const get = (tag) => {
      const r = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
      const tm = block.match(r);
      return tm ? tm[1].trim() : null;
    };
    const stripCdata = (s) => (s ? s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') : s);
    const decodeEntities = (s) =>
      (s || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
    const title = stripCdata(decodeEntities(get('title') || ''));
    const link = stripCdata(decodeEntities(get('link') || ''));
    const desc = stripCdata(decodeEntities(get('description') || ''));
    const pubDate = stripCdata(decodeEntities(get('pubDate') || ''));
    const guid = stripCdata(decodeEntities(get('guid') || ''));
    const m2 = link.match(/\/statuses\/(\d+)/);
    const id = m2 ? m2[1] : guid.split('/').pop();
    // Strip HTML tags from description and trim
    const text = desc.replace(/<[^>]+>/g, '').trim();
    items.push({ id, link, title, text, date: pubDate });
  }
  return items;
}

/**
 * Scrape an image URL from a /statuses/{id} HTML page.
 * Looks for the canonical truth-archive.us-iad-1.linodeobjects.com pattern.
 */
async function fetchImageForPost(pageUrl) {
  try {
    const res = await fetch(pageUrl, { headers: HEADERS });
    if (!res.ok) return null;
    const html = await res.text();
    // Most posts: look for og:image or the truth-archive attachment
    const ogMatch = html.match(
      /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i
    );
    if (ogMatch) return ogMatch[1];
    // Fallback: largest image with truth-archive host
    const imgs = [...html.matchAll(/https:\/\/truth-archive[^"'\s>]+\.(?:jpg|jpeg|png|webp)/gi)];
    if (imgs.length) return imgs[0][0];
  } catch {}
  return null;
}

async function fetchPosts(prior) {
  console.log('[trump] fetching RSS feed…');
  const xml = await fetchRSS();
  const rawItems = parseRSS(xml);
  console.log(`[trump] RSS items: ${rawItems.length}`);

  // Carry-forward image + text_cn for stable order
  const priorById = new Map();
  for (const p of prior?.posts || []) priorById.set(p.id, p);

  // Identify which posts need translation: brand-new IDs (no prior entry)
  // OR a prior entry that had null/empty text_cn. Skips "[No Title]" stubs.
  const needsTranslation = [];
  const skipTranslation = (rawText) =>
    !rawText || /^[\s\S]*\[No Title\]/.test(rawText || '');

  const posts = [];
  // First 15 posts get image enrichment (heavy: extra GET per post)
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    const priorEntry = priorById.get(raw.id);
    const text = raw.text || raw.title || '';
    const post = {
      id: raw.id,
      link: raw.link,
      text,
      date: formatPubDate(raw.date),
      source: priorEntry?.source || 'truth_social',
      image: priorEntry?.image || null,
      has_image: false,
      text_cn: priorEntry?.text_cn || null,
    };
    if (i < 15 && !post.image) {
      const img = await fetchImageForPost(raw.link);
      if (img) post.image = img;
      await sleep(150);
    }
    post.has_image = !!post.image;
    if (!post.text_cn && !skipTranslation(text)) {
      needsTranslation.push({ idx: posts.length, text });
    }
    posts.push(post);
  }

  // Batch-translate any new posts. Cap at 25/round so a single feed refresh
  // costs at most ~4 round-trips (~600ms) regardless of how many new posts.
  if (needsTranslation.length) {
    console.log(`[trump] translating ${needsTranslation.length} new posts…`);
    const texts = needsTranslation.map((n) => n.text);
    const zhs = await translateBatch(texts, { batchSize: 25 });
    let translatedCount = 0;
    for (let i = 0; i < needsTranslation.length; i++) {
      const { idx } = needsTranslation[i];
      const zh = zhs[i];
      if (zh && zh !== texts[i]) {
        posts[idx].text_cn = zh;
        translatedCount++;
      }
    }
    console.log(`[trump] translated ${translatedCount}/${needsTranslation.length} posts`);
  } else {
    console.log('[trump] no new posts to translate');
  }
  return posts;
}

/** "Sun, 26 Jul 2026 15:43:18 +0000" → "2026-07-26 15:43" (matches prior shape). */
function formatPubDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

// ──────────────────────────────────────────────────────────────
// Source 2: QuiverQuant /Donald-Trump-Stock-Trades/
// ──────────────────────────────────────────────────────────────

async function fetchQuiverTrades() {
  console.log('[trump] fetching QuiverQuant page…');
  const res = await fetch(QUIVER_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`QuiverQuant HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/trumpTradesData\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) throw new Error('trumpTradesData variable not found');
  // JS literal with double-quoted strings + NaN/Infinity; first sanitize,
  // then JSON.parse. The trumpTradesData JS variable is well-formed array of
  // mixed-type elements and JSON.parse handles it once NaN is gone.
  const arrLiteral = m[1]
    .replace(/\bNaN\b/g, 'null')
    .replace(/\bInfinity\b/g, 'null')
    .replace(/\b-Infinity\b/g, 'null');
  const rows = JSON.parse(arrLiteral);
  console.log(`[trump] QuiverQuant rows: ${rows.length}`);

  // Row format (verified 2026-07-27):
  //   ['TICKER', 'Type' (Purchase/Sale/...), 'filed date', 'traded date',
  //    pct (number|null), '$1,001 - $15,000', 'COMPANY NAME', 'Trump-NNNN', amount]
  // QuiverQuant may publish the same trade in multiple filing waves
  // (e.g. amendment or late-disclosed copy). Dedupe by (traded_date, ticker, type).
  const seen = new Set();
  const trades = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    if (r.length < 8) continue;
    const [ticker, transaction, filed, traded, pct, range, company] = r;
    const tkr = ticker ? String(ticker) : '';
    const type = String(transaction || '').trim();
    const trd = String(traded || '').slice(0, 10);
    const key = `${tkr}|${type}|${trd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    trades.push({
      stock: `${tkr}\n${company ?? ''}`.trim(),
      ticker: tkr,
      transaction: formatTransaction(transaction, range),
      filed: formatDateOnly(filed),
      traded: trd,
      return_pct: typeof pct === 'number' ? pct : null,
      source: 'quiverquant',
    });
  }
  // Sort newest traded first, then trim to 200 (page renders ~25 visible
  // rows in a 400px table; 200 keeps 6+ scroll pages of headroom).
  trades.sort((a, b) => (b.traded || '').localeCompare(a.traded || ''));
  return trades.slice(0, 200);
}

function formatTransaction(type, range) {
  const t = String(type || '').trim();
  const r = String(range || '').trim();
  return r ? `${t}\n${r}` : t;
}

function formatDateOnly(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toISOString().slice(0, 10);
}

/**
 * (No longer needed — trumpTradesData from QuiverQuant is double-quoted JSON,
 *  parses natively after NaN→null substitution. Kept as a comment so we
 *  remember we tried.)
 */

// ──────────────────────────────────────────────────────────────
// SEC EDGAR: skip — the original used it but the prior JSON shows
// the section was always empty for Trump; keep behavior the same.
// ──────────────────────────────────────────────────────────────

async function fetchFilings() {
  return [];
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  const prior = loadPrior();
  console.log(`[trump] prior updated=${prior?.updated} posts=${(prior?.posts || []).length} trades=${(prior?.quiver_trades || []).length}`);

  const [posts, quiver_trades, filings] = await Promise.all([
    fetchPosts(prior).catch((e) => { console.warn('[trump] RSS failed:', e.message); return prior?.posts || []; }),
    fetchQuiverTrades().catch((e) => { console.warn('[trump] Quiver failed:', e.message); return prior?.quiver_trades || []; }),
    fetchFilings(),
  ]);

  const out = {
    updated: new Date().toISOString(),
    posts: (posts.length ? posts : (prior?.posts || [])),
    filings,
    quiver_trades,
  };

  fs.writeFileSync(TMP_PATH, JSON.stringify(out, null, 2));
  fs.renameSync(TMP_PATH, OUT_PATH);

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[trump] wrote ${OUT_PATH}`);
  console.log(`[trump] posts: ${out.posts.length} (newest: ${out.posts[0]?.date || '?'})`);
  console.log(`[trump] trades: ${out.quiver_trades.length} (newest filed: ${out.quiver_trades[0]?.filed || '?'})`);
  console.log(`[trump] done in ${dt}s`);
}

main().catch((err) => {
  console.error('[trump] FATAL', err);
  process.exit(1);
});
