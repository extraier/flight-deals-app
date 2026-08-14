/* eslint-disable no-console */
/**
 * scripts/seed-spots-firestore.mjs
 *
 * Phase 3.3 — write enriched city/landmark data to Firestore.
 * Reads scripts/seed-spots-enriched.json (Phase 3.2 output) and writes
 * one coupleSpots doc per landmark.
 *
 * Each doc matches the existing 31-spot schema:
 *   { id, name, nameEn, country, countryCode, city, cityEn, region,
 *     blurb, image, imageCredit, priceLevel, dealCode, tags, travelMood }
 *
 * Batching strategy:
 *   Firestore REST commit() supports max 500 mutations per call. We batch
 *   400 at a time for safety. With 640 spots, that's 2 commit() calls.
 *
 * Idempotency:
 *   The commit overwrites each doc by `id` — running the seed twice is
 *   safe. New docs overwrite existing docs with the same ID (rare; only
 *   matters if you curate the list and re-seed).
 *
 * Usage:
 *   node /Users/roger/Projects/flight-deals-app/scripts/seed-spots-firestore.mjs [--dry-run]
 *
 * --dry-run: build the payload, print summary stats, don't commit.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import https from 'https';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENRICHED_PATH = path.join(PROJECT_ROOT, 'scripts/seed-spots-enriched.json');

const DRY_RUN = process.argv.includes('--dry-run');

const SA_PATHS = [
  '/Users/roger/.firebase-keys/savetheday-2377a.json',
  '/Users/roger/.hermes/secrets/savetheday-firebase-sa.json',
  '/Users/roger/.config/gcloud/legacy_credentials/firebase-adminsdk-fbsvc@savetheday-2377a.iam.gserviceaccount.com/adc.json',
];

let sa;
for (const p of SA_PATHS) {
  try {
    const s = JSON.parse(readFileSync(p, 'utf8'));
    if (s.project_id) { sa = s; break; }
  } catch (_) {}
}
if (!sa) throw new Error('No service account with project_id found');
const PROJECT = sa.project_id;
console.log(`Using service account for project: ${PROJECT}`);

// ── OAuth2 token ───────────────────────────────────────────────────────────
async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  };
  const signed = jwt.sign(payload, sa.private_key, { algorithm: 'RS256' });
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: signed,
  }).toString();
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).access_token); }
        catch (e) { reject(new Error('token parse: ' + d)); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── HTTP helper ────────────────────────────────────────────────────────────
function http(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`${method} ${url} → ${res.statusCode}: ${d.substring(0, 300)}`));
        } else {
          try { resolve(JSON.parse(d)); }
          catch (e) { resolve(d); }
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Region → default tags mapping ─────────────────────────────────────────
// Used when the landmark doesn't have explicit tags. Keep it small;
// admin can refine via the /match/admin UI.
const REGION_DEFAULT_TAGS = {
  '歐洲': ['文化', '歷史'],
  '美洲': ['文化', '城市'],
  '中東': ['文化', '歷史'],
  '非洲': ['歷史', '探險'],
  '南亞': ['文化', '歷史'],
  '東亞': ['文化', '美食'],
  '東南亞': ['海景', '美食'],
  '大洋洲': ['海景', '探險'],
  '中亞': ['歷史', '探險'],
  '北亞': ['自然', '探險'],
  '香港': ['文化', '美食'],
};

const REGION_DEFAULT_MOOD = {
  '歐洲': ['文化'],
  '美洲': ['探險'],
  '中東': ['文化'],
  '非洲': ['探險'],
  '南亞': ['文化'],
  '東亞': ['美食'],
  '東南亞': ['度假'],
  '大洋洲': ['度假'],
  '中亞': ['探險'],
  '北亞': ['探險'],
  '香港': ['美食'],
};

// ── Slug helper (kept consistent with seed-spots-cities.json) ──────────────
function slug(s) {
  return s.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Build a Firestore fields dict (matches existing 31-spot schema) ────────
function buildSpotFields(city, landmark, imageUrl) {
  const id = `${slug(city.cityEn)}-${slug(landmark.nameEn)}`;
  const tags = landmark.tags || REGION_DEFAULT_TAGS[city.regionZh] || ['文化'];
  const travelMood = landmark.travelMood || REGION_DEFAULT_MOOD[city.regionZh] || ['文化'];

  const fields = {
    id: { stringValue: id },
    name: { stringValue: landmark.nameZh || landmark.nameEn },
    nameEn: { stringValue: landmark.nameEn },
    country: { stringValue: city.countryZh || city.countryEn },
    countryCode: { stringValue: city.countryCode },
    city: { stringValue: city.cityZh || city.cityEn },
    cityEn: { stringValue: city.cityEn },
    region: { stringValue: city.regionZh },
    dealCode: { stringValue: city.dealCode },
    priceLevel: { integerValue: city.defaultPriceLevel || 2 },
    blurb: { stringValue: landmark.blurbZh || landmark.blurbEn || '' },
    tags: { arrayValue: { values: tags.map(t => ({ stringValue: t })) } },
    travelMood: { arrayValue: { values: travelMood.map(t => ({ stringValue: t })) } },
  };

  // Image is optional — skip the field if Wikimedia didn't resolve one.
  // Existing spots all have an image field; absence will fall through to
  // the existing fallback in the client.
  if (imageUrl) {
    fields.image = { stringValue: imageUrl };
    fields.imageCredit = { stringValue: 'Wikimedia Commons' };
  }

  return { id, fields };
}

// ── Commit a batch of mutations to Firestore ──────────────────────────────
async function commitBatch(batch, token) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`;
  return http('POST', url, {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  }, JSON.stringify({ writes: batch }));
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(ENRICHED_PATH)) {
    throw new Error(`Missing ${path.basename(ENRICHED_PATH)} — run seed-spots-wikimedia.mjs first`);
  }
  const data = JSON.parse(readFileSync(ENRICHED_PATH, 'utf8'));
  const cities = data.cities;
  console.log(`Loaded ${cities.length} cities, ${data.wikimediaStats?.totalLandmarks || '?'} landmarks`);

  // Build all spots in memory
  const allSpots = [];
  let withImage = 0;
  let withoutImage = 0;
  for (const city of cities) {
    for (const landmark of city.landmarks) {
      const { id, fields } = buildSpotFields(city, landmark, landmark.imageUrl);
      allSpots.push({ id, fields });
      if (landmark.imageUrl) withImage++; else withoutImage++;
    }
  }

  console.log(`\nTotal spots to write: ${allSpots.length}`);
  console.log(`  With image: ${withImage} (${((withImage/allSpots.length)*100).toFixed(1)}%)`);
  console.log(`  Without image: ${withoutImage} (admin can backfill)`);

  // Region breakdown
  const regionCounts = {};
  for (const s of allSpots) {
    const r = s.fields.region.stringValue;
    regionCounts[r] = (regionCounts[r] || 0) + 1;
  }
  console.log('\nBy region:');
  for (const [r, c] of Object.entries(regionCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r}: ${c}`);
  }

  // Spot ID collisions check (with the existing 31)
  const existing = new Set([
    'bali-uluwatu','bangkok-grand-palace','beijing-forbidden-city','cebu-chocolate-hills',
    'chiang-mai','chiang-rai-blue','fukuoka-hakata','halong-bay','hanoi-old-quarter',
    'hongkong-disneyland','hongkong-victoria-peak','kualalumpur-petronas','kumamoto-castle',
    'kyoto-fushimi','macau-ruins','manila-banaue','nara-deer','osaka-dotonbori',
    'penang-george-town','phuket-beach','seoul-bukchon','seoul-gangnam','shanghai-bund',
    'singapore-gardens','singapore-marina-bay','sydney-opera','taipei-101','taipei-jiufen',
    'tokyo-disneysea','tokyo-shibuya','tokyo-teamlab',
  ]);
  const collisions = allSpots.filter(s => existing.has(s.id));
  if (collisions.length > 0) {
    console.warn(`\n⚠ ${collisions.length} collisions with existing 31 spots — will overwrite:`);
    collisions.slice(0, 5).forEach(c => console.warn(`  - ${c.id}`));
    if (collisions.length > 5) console.warn(`  ...and ${collisions.length - 5} more`);
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: not committing');
    console.log('First 3 spots (truncated):');
    allSpots.slice(0, 3).forEach(s => console.log(' ', s.id, '|', s.fields.name.stringValue, '|', s.fields.country.stringValue));
    return;
  }

  // Commit in batches of 400
  const token = await getToken();
  console.log('\n✓ Got access token');

  const BATCH_SIZE = 400;
  let batchIdx = 0;
  for (let i = 0; i < allSpots.length; i += BATCH_SIZE) {
    const batch = allSpots.slice(i, i + BATCH_SIZE).map(s => ({
      update: {
        name: `projects/${PROJECT}/databases/(default)/documents/coupleSpots/${s.id}`,
        fields: s.fields,
      },
    }));
    batchIdx++;
    console.log(`\nCommitting batch ${batchIdx} (${batch.length} spots)...`);
    const result = await commitBatch(batch, token);
    const writeResults = result.writeResults || [];
    const succeeded = writeResults.filter(r => r.updateTime).length;
    console.log(`  ✓ Batch ${batchIdx} done: ${succeeded}/${batch.length} succeeded`);
    if (succeeded < batch.length) {
      console.log(`  ⚠ ${batch.length - succeeded} failures — check writeResults[].status`);
    }
  }

  console.log('\n✓ All batches committed. Run scripts/refresh-couple-images.mjs to backfill images later if needed.');
}

import { existsSync } from 'fs';
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
