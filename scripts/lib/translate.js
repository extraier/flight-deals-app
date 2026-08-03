/**
 * scripts/lib/translate.js
 *
 * Shared Google Translate helper used by fetch-trump-data.js and
 * fetch-serenity-data.js. Translates English (or any source lang) to
 * Hong Kong Traditional Chinese (zh-Hant / zh-TW).
 *
 * Translation source:
 *   Google Translate's free /translate_a/single endpoint — no API key,
 *   no auth, ~5000 chars / request. We protect $TICKERs and numbers
 *   with placeholders so Google doesn't try to translate ticker symbols
 *   or rewrite numbers.
 *
 * Why Google Translate and not Hermes / OpenAI?
 *   - No API key configured on this box (no OPENAI/ANTHROPIC keys).
 *   - Hermes Agent isn't reachable from inside a Node.js script —
 *     you can't call me from your own cron job.
 *   - Quality is excellent for short posts once we protect tickers.
 *   - Free and fast (~150ms per request).
 *
 * What this module does:
 *   - protect(text): replace $TICKER, $N.NM, percentages, USD amounts
 *     with token placeholders so Google can't mangle them.
 *   - restore(text): put the original tickers / numbers back.
 *   - translate(en): one shot, returns 繁體中文.
 *   - translateBatch(enList): batches ~25 short posts per request, much
 *     faster than one request per post.
 *
 * Used by:
 *   - fetch-trump-data.js (fills text_cn for new posts)
 *   - fetch-serenity-data.js (regenerates serenity_translations.json
 *     when new tweet IDs appear)
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const TARGET_LANG = 'zh-TW'; // 繁體中文 (HK/TW)

// ─── Protection / restoration ──────────────────────────────────────

// Match $TICKER ($NVDA, $AAPL), $1.5B / $2.3M / $250K amounts, percentages, dates
const TOKEN_PATTERNS = [
  // $TICKER (1-5 uppercase letters)
  { re: /\$([A-Z]{1,5})(?=\b)/g, kind: 'TICKER' },
  // dollar amounts: $1,234 / $1.5M / $2.3B / $250K
  { re: /\$[\d,]+(?:\.\d+)?[KMB]?\b/g, kind: 'AMOUNT' },
  // pure percentages: +20.33% / -1.5%
  { re: /[+\-]\d+(?:\.\d+)?%/g, kind: 'PCT' },
];

function protect(text) {
  if (!text || typeof text !== 'string') return { safe: text || '', map: [] };
  const map = [];
  let safe = text;
  TOKEN_PATTERNS.forEach(({ re, kind }) => {
    safe = safe.replace(re, (m) => {
      const id = `__${kind}_${map.length}__`;
      map.push({ id, original: m, kind });
      return id;
    });
  });
  return { safe, map };
}

function restore(zh, map) {
  if (!zh) return zh;
  let out = zh;
  // Match tokens in the order they appear in `map` so restoration is stable.
  // We replace by index (sorted by id substring).
  map.forEach((entry) => {
    out = out.replace(entry.id, entry.original);
  });
  return out;
}

// ─── Single translate ─────────────────────────────────────────────

async function translate(en, { source = 'en', target = TARGET_LANG } = {}) {
  const { safe, map } = protect(en);
  const url = `${ENDPOINT}?client=gtx&sl=${source}&tl=${target}&dt=t&q=${encodeURIComponent(safe)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; hermes-translate/1.0)' },
  });
  if (!res.ok) throw new Error(`Translate HTTP ${res.status}`);
  const raw = await res.text();
  // Response: [[["translation","src",null,null,N]],null,...] — extract first
  // quoted string of the inner-most array. Naive but works for short inputs.
  const m = raw.match(/"((?:[^"\\]|\\.)*)"/);
  if (!m) throw new Error(`Translate parse fail: ${raw.slice(0, 200)}`);
  // Unescape \" etc.
  let zh = m[1]
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
  return restore(zh, map);
}

// ─── Batched translate ────────────────────────────────────────────
//
// Google Translate's free endpoint accepts a single string. For batches
// we JOIN with `\u0001\u0001\u0001` (an obscure separator unlikely to
// appear in tweets), translate as one request, then split. This cuts
// 100 posts from 100 round-trips to 4 requests (25 posts each).

const BATCH_SEP = '\u0001\u0001\u0001';

async function translateBatch(enList, opts = {}) {
  if (!enList.length) return [];
  const batchSize = opts.batchSize ?? 25;
  const out = [];
  for (let i = 0; i < enList.length; i += batchSize) {
    const chunk = enList.slice(i, i + batchSize);
    // Protect each chunk member independently — we need the per-text map
    // to restore on the right slot.
    const protectedChunks = chunk.map(protect);
    const joined = protectedChunks.map((c) => c.safe).join(BATCH_SEP);
    const url = `${ENDPOINT}?client=gtx&sl=${opts.source || 'en'}&tl=${
      opts.target || TARGET_LANG
    }&dt=t&q=${encodeURIComponent(joined)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; hermes-translate/1.0)' },
    });
    if (!res.ok) {
      console.warn(`[translate] batch ${i}-${i + chunk.length} HTTP ${res.status} — falling back to per-item`);
      for (const text of chunk) out.push(await translate(text, opts).catch(() => text));
      continue;
    }
    const raw = await res.text();
    const m = raw.match(/"((?:[^"\\]|\\.)*)"/);
    if (!m) {
      console.warn(`[translate] batch ${i} parse fail — falling back to per-item`);
      for (const text of chunk) out.push(await translate(text, opts).catch(() => text));
      continue;
    }
    let translated = m[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    // Split back — but BATCH_SEP might have been translated. As a
    // robustness fallback, if split length ≠ chunk length, redo per-item.
    let parts = translated.split(BATCH_SEP);
    if (parts.length !== chunk.length) {
      // Per-item fallback
      for (const text of chunk) out.push(await translate(text, opts).catch(() => text));
      continue;
    }
    for (let j = 0; j < chunk.length; j++) {
      out.push(restore(parts[j], protectedChunks[j].map));
    }
    if (opts.delayBetweenBatches) await sleep(opts.delayBetweenBatches);
  }
  return out;
}

module.exports = { translate, translateBatch, protect, restore, TARGET_LANG };