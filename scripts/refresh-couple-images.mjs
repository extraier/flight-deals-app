/* eslint-disable no-console */
// Refresh the `image` field on every coupleSpots / coupleAds doc with a real,
// Wikimedia-curated lead image from the Wikipedia REST API. Runs ONE-TIME to
// replace the fabricated URLs in seed JSON that gave 400s.
//
// Usage:  node /Users/roger/scripts/refresh-couple-images.mjs
// Side effects: writes file with ?utm_source= stripped, then PATCHes each
// doc in Firestore.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import https from 'https';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = '/Users/roger/projects/flight-deals-app';
const SA_PATHS = [
  '/Users/roger/.hermes/secrets/savetheday-firebase-sa.json',
  '/Users/roger/.config/gcloud/legacy_credentials/firebase-adminsdk-fbsvc@savetheday-2377a.iam.gserviceaccount.com/adc.json',
];

// ── Pick service account with project_id (gcloud's omits it) ───────────────
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

// ── Get access token for Firestore REST API ────────────────────────────────
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length },
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
          reject(new Error(`${method} ${url} → ${res.statusCode}: ${d.substring(0, 200)}`));
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

// ── Fetch the Wikipedia lead image for an article ─────────────────────────
async function getLeadImage(title) {
  const apiUrl = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'pageimages',
    titles: title,
    pithumbsize: '960',
    redirects: '1',
  }).toString();
  const data = await http('GET', apiUrl, {
    'User-Agent': 'Hermes Couple Room/1.0 (contact: extraier@gmail.com)',
  });
  const pages = data.query?.pages || {};
  for (const p of Object.values(pages)) {
    const thumb = p.thumbnail;
    if (thumb?.source) {
      // Strip ?utm_source= tracking
      return thumb.source.split('?')[0];
    }
  }
  return null;
}

// ── Patch a Firestore doc via REST (update only `image`) ──────────────────
async function updateImageField(collection, docId, imageUrl, token) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${docId}`;
  const body = JSON.stringify({
    fields: { image: { stringValue: imageUrl } },
  });
  // Use PATCH with updateMask to update only the `image` field
  const maskUrl = `${url}?updateMask.fieldPaths=image`;
  return http('PATCH', maskUrl, {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Hermes Couple Room/1.0',
  }, body);
}

// Hardcoded fallback URLs — when Wikipedia's article lead is missing or
// wrong (e.g. logo for an art collective), use these directly verified
// Commons file thumbnails instead.
const FALLBACK_URL = {
  'tokyo-teamlab': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/TeamLab_Borderless_Azabudai_Hills.jpg/960px-TeamLab_Borderless_Azabudai_Hills.jpg',
};

// ── Spot ID → Wikipedia article title mapping ─────────────────────────────
// Hermes-curated. Wikipedia article leads give us a quality-curated image
// of the actual landmark. Falls back to a generic landmark search below.
const SPOT_TITLE = {
  'tokyo-shibuya': 'Shibuya Crossing',
  'tokyo-teamlab': 'TeamLab (art collective)',
  'osaka-dotonbori': 'Dotonbori',
  'kyoto-fushimi': 'Fushimi Inari-taisha',
  'seoul-gangnam': 'Gangnam District',
  'seoul-bukchon': 'Bukchon Hanok Village',
  'bangkok-grand-palace': 'Grand Palace, Bangkok',
  'phuket-beach': 'Patong Beach',
  'chiang-mai': 'Chiang Mai',
  'taipei-101': 'Taipei 101',
  'taipei-jiufen': 'Jiufen',
  'singapore-marina-bay': 'Marina Bay Sands',
  'singapore-gardens': 'Gardens by the Bay',
  'kualalumpur-petronas': 'Petronas Towers',
  'bali-uluwatu': 'Uluwatu Temple',
  'hanoi-old-quarter': 'Old Quarter, Hanoi',
  'halong-bay': 'Hạ Long Bay',
  'cebu-chocolate-hills': 'Chocolate Hills',
  'shanghai-bund': 'The Bund (Shanghai)',
  'beijing-forbidden-city': 'Forbidden City',
  'hongkong-victoria-peak': 'Victoria Peak',
  'hongkong-disneyland': 'Hong Kong Disneyland',
  'macau-ruins': "Ruins of St. Paul's",
  'tokyo-disneysea': 'Tokyo DisneySea',
  'kumamoto-castle': 'Kumamoto Castle',
  'nara-deer': 'Nara Park',
  'chiang-rai-blue': 'Wat Rong Khun',
  'manila-banaue': 'Banaue Rice Terraces',
  'fukuoka-hakata': 'Hakata',
  'penang-george-town': 'George Town, Penang',
  'sydney-opera': 'Sydney Opera House',
};

// Ad ID → generic landmark or city (we just want a nice travel-y card)
const AD_TITLE = {
  'ad-trip-tokyo': 'Mount Fuji',
  'ad-compare-tiger-hkg': 'Hong Kong skyline',
  'ad-compare-tiger-szx': 'Shenzhen',
  'ad-trip-bangkok': 'Wat Arun',
  'ad-trip-hotel': 'Infinity pool',
};

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const token = await getToken();
  console.log('✓ Got access token');

  const spots = JSON.parse(readFileSync(`${projectRoot}/src/data/couple/spots.json`, 'utf8')).spots;
  const ads = JSON.parse(readFileSync(`${projectRoot}/src/data/couple/ads.json`, 'utf8')).ads;

  let ok = 0, missing = 0, failed = 0;

  console.log(`\n── ${spots.length} spots ──`);
  for (const s of spots) {
    const title = SPOT_TITLE[s.id];
    if (!title) { console.log(`  SKIP ${s.id}: no title mapping`); missing++; continue; }
    let img;
    if (FALLBACK_URL[s.id]) {
      img = FALLBACK_URL[s.id];
    } else {
      try {
        img = await getLeadImage(title);
      } catch (e) {
        console.log(`  ERROR ${s.id} (${title}): ${e.message}`); failed++; continue;
      }
    }
    if (!img) {
      console.log(`  MISS ${s.id}: no image for "${title}"`); missing++; continue;
    }
    try {
      await updateImageField('coupleSpots', s.id, img, token);
      s.image = img;  // update local copy
      ok++;
      process.stdout.write(`  ✓ ${s.id}\r`);
    } catch (e) {
      console.log(`  UPD-ERR ${s.id}: ${e.message}`); failed++;
    }
  }
  console.log(`\n\n── ${ads.length} ads ──`);
  for (const a of ads) {
    const title = AD_TITLE[a.id];
    if (!title) { console.log(`  SKIP ${a.id}: no title mapping`); missing++; continue; }
    let img;
    try {
      img = await getLeadImage(title);
    } catch (e) {
      console.log(`  ERROR ${a.id} (${title}): ${e.message}`); failed++; continue;
    }
    if (!img) {
      console.log(`  MISS ${a.id}: no image for "${title}"`); missing++; continue;
    }
    try {
      await updateImageField('coupleAds', a.id, img, token);
      a.image = img;
      ok++;
      process.stdout.write(`  ✓ ${a.id}\r`);
    } catch (e) {
      console.log(`  UPD-ERR ${a.id}: ${e.message}`); failed++;
    }
  }

  // Save the updated local JSON
  const spotsPath = `${projectRoot}/src/data/couple/spots.json`;
  const adsPath = `${projectRoot}/src/data/couple/ads.json`;
  const fs = await import('fs');
  fs.writeFileSync(spotsPath, JSON.stringify(JSON.parse(readFileSync(spotsPath, 'utf8')), null, 2));
  fs.writeFileSync(adsPath, JSON.stringify(JSON.parse(readFileSync(adsPath, 'utf8')), null, 2));

  console.log(`\n✓ ${ok} updated, ${missing} missing, ${failed} errors`);
}

main().catch(e => { console.error(e); process.exit(1); });
