/* eslint-disable no-console */
/**
 * scripts/seed-spots-wikimedia.mjs
 *
 * Phase 3.2 — enrich the curated city list with Wikimedia Commons lead
 * images. Reads scripts/seed-spots-cities.json, for each landmark calls
 * Wikipedia's `pageimages` REST API to get the curated lead image, and
 * writes scripts/seed-spots-enriched.json with the image URL embedded
 * under `landmark.imageUrl`.
 *
 * Caching strategy:
 *   - Per-landmark cache file: scripts/.wikimedia-cache.json (keyed by
 *     landmark slug). On re-run, cached hits skip the network entirely.
 *   - Throttle: 1.1s between requests (~1 req/sec, conservative ToS).
 *   - 640 landmarks × 1.1s = ~12 minutes for cold cache.
 *
 * Failure modes (non-fatal):
 *   - Landmark not found on Wikipedia → imageUrl stays null, seed script
 *     will fall back to no-image or a generic city placeholder.
 *   - Network error → log + skip + leave imageUrl null.
 *
 * Usage:
 *   node /Users/roger/Projects/flight-deals-app/scripts/seed-spots-wikimedia.mjs [--dry-run]
 *
 * --dry-run: do everything except writing the enriched JSON file (useful
 * to validate that 90%+ of landmarks find an image before committing the
 * full seed).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CITIES_PATH = path.join(PROJECT_ROOT, 'scripts/seed-spots-cities.json');
const ENRICHED_PATH = path.join(PROJECT_ROOT, 'scripts/seed-spots-enriched.json');
const CACHE_PATH = path.join(PROJECT_ROOT, 'scripts/.wikimedia-cache.json');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE_REFETCH = process.argv.includes('--force-refetch');

const USER_AGENT = 'HermesFlightDealsSeed/1.0 (contact: extraier@gmail.com)';
const THROTTLE_MS = 1100; // 1.1s — conservative against Wikipedia ToS

// ── HTTP helper (Node-only) ────────────────────────────────────────────────
function httpJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          ...(opts.headers || {}),
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`${u.pathname} → ${res.statusCode}: ${d.substring(0, 200)}`));
          }
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(new Error('JSON parse: ' + d.substring(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Wikipedia lead image fetcher ───────────────────────────────────────────
// Tries the primary hint first; on miss, retries with the bare landmark
// name; on miss again, falls back to "<landmark name> <city>" combo.
// On all misses, returns null (the seed script can decide what to do).
async function fetchLeadImage(query) {
  const apiUrl =
    'https://en.wikipedia.org/w/api.php?' +
    new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'pageimages',
      titles: query,
      pithumbsize: '960',
      redirects: '1',
    }).toString();
  const data = await httpJson(apiUrl);
  const pages = data.query?.pages || {};
  for (const p of Object.values(pages)) {
    const thumb = p.thumbnail;
    if (thumb?.source) {
      // Strip ?utm_source= tracking suffix
      return thumb.source.split('?')[0];
    }
  }
  return null;
}

// ── Slug helper ────────────────────────────────────────────────────────────
function slug(s) {
  return s
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Load cache ─────────────────────────────────────────────────────────────
function loadCache() {
  if (existsSync(CACHE_PATH)) {
    try {
      return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    } catch (_) {
      console.warn('Cache file unreadable, starting fresh');
    }
  }
  return {};
}

function saveCache(cache) {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// ── Resolve a single landmark's image (with cache + retry ladder) ──────────
async function resolveImage(landmark, cityEn, cache) {
  const key = `${cityEn}|${landmark.nameEn}`;

  if (!FORCE_REFETCH && cache[key]) {
    return cache[key]; // may be null (cached miss)
  }

  // Retry ladder — Wikipedia often has the landmark under a slightly
  // different name. Try the configured hint first, then fall back.
  const queries = [
    landmark.imageHint,
    landmark.nameEn,
    `${landmark.nameEn} ${cityEn}`,
    `${landmark.nameEn} ${cityEn.split(' ')[0]}`, // first word only
  ].filter(Boolean);

  let lastError = null;
  for (const q of queries) {
    try {
      const img = await fetchLeadImage(q);
      cache[key] = img; // null = confirmed miss
      return img;
    } catch (e) {
      lastError = e;
      // 5xx / network error — wait then try next query
      await sleep(THROTTLE_MS);
    }
  }
  console.warn(`  [MISS] ${landmark.nameEn} (${cityEn}): ${lastError?.message || 'no image'}`);
  cache[key] = null;
  return null;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  const data = JSON.parse(readFileSync(CITIES_PATH, 'utf8'));
  const cities = data.cities;
  console.log(`Loaded ${cities.length} cities from ${path.basename(CITIES_PATH)}`);

  const totalLandmarks = cities.reduce((sum, c) => sum + c.landmarks.length, 0);
  console.log(`Total landmarks to enrich: ${totalLandmarks}`);

  const cache = loadCache();
  if (Object.keys(cache).length > 0 && !FORCE_REFETCH) {
    const cachedLandmarks = Object.values(cache).filter((v) => v).length;
    console.log(`Cache: ${cachedLandmarks} hits, ${Object.values(cache).filter((v) => !v).length} known misses`);
  }

  let hits = 0;
  let misses = 0;
  let processed = 0;
  let cacheFlushCounter = 0;

  for (const city of cities) {
    for (const lm of city.landmarks) {
      processed++;
      const img = await resolveImage(lm, city.cityEn, cache);
      if (img) {
        lm.imageUrl = img;
        hits++;
      } else {
        lm.imageUrl = null;
        misses++;
      }
      // Progress log every 25 landmarks
      if (processed % 25 === 0 || processed === totalLandmarks) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const rate = (processed / (Date.now() - t0)) * 1000;
        const eta = ((totalLandmarks - processed) / rate).toFixed(0);
        process.stdout.write(
          `\r  ${processed}/${totalLandmarks} (${hits}✓ ${misses}✗) ${elapsed}s elapsed, ETA ${eta}s — last: ${lm.nameEn}`
        );
      }
      // Hermes 2026-08-14: persist cache every 50 landmarks so a SIGTERM
      // doesn't lose everything. (The previous version only saved on
      // completion, which cost us ~350 cached lookups when the process
      // got killed mid-run.)
      cacheFlushCounter++;
      if (cacheFlushCounter >= 50) {
        saveCache(cache);
        cacheFlushCounter = 0;
      }
      // Throttle between every request — Wikipedia ToS
      await sleep(THROTTLE_MS);
    }
  }

  console.log('\n');
  console.log(`✓ ${hits} hits, ${misses} misses (${((hits / totalLandmarks) * 100).toFixed(1)}% success)`);

  // Always save cache
  saveCache(cache);
  console.log(`Cache saved to ${path.basename(CACHE_PATH)}`);

  if (DRY_RUN) {
    console.log('\n--dry-run: not writing enriched JSON');
    return;
  }

  // Save enriched output
  data.generatedAt = new Date().toISOString();
  data.wikimediaStats = {
    totalLandmarks,
    hits,
    misses,
    successRate: hits / totalLandmarks,
    runDurationSec: ((Date.now() - t0) / 1000).toFixed(1),
  };
  writeFileSync(ENRICHED_PATH, JSON.stringify(data, null, 2));
  console.log(`Wrote ${path.basename(ENRICHED_PATH)}`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
