/* eslint-disable no-console */
// Fill the `image` field for every coupleSpots doc that is missing it,
// using Wikipedia lead images (pageimages) with search fallback.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import https from 'https';
import jwt from 'jsonwebtoken';

const projectRoot = '/Users/roger/Projects/flight-deals-app';
const SA_PATHS = [
  '/Users/roger/.hermes/secrets/savetheday-firebase-sa.json',
];
let sa;
for (const p of SA_PATHS) {
  try { const s = JSON.parse(readFileSync(p, 'utf8')); if (s.project_id) { sa = s; break; } } catch (_) {}
}
if (!sa) throw new Error('No service account with project_id found');
const PROJECT = sa.project_id;
const UA = 'Hermes Couple Room/1.0 (contact: extraier@gmail.com)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const signed = jwt.sign({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }, sa.private_key, { algorithm: 'RS256' });
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: signed,
  }).toString();
  const r = await http('POST', 'https://oauth2.googleapis.com/token', { 'Content-Type': 'application/x-www-form-urlencoded' }, body);
  return r.access_token;
}

function http(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`${method} ${u.pathname} → ${res.statusCode}: ${d.substring(0, 200)}`));
        else { try { resolve(JSON.parse(d)); } catch (e) { resolve(d); } }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Firestore: list all coupleSpots docs (paginated) ──────────────────────
async function listAllSpots(token) {
  const out = [];
  let pageToken = null;
  do {
    const qs = new URLSearchParams({ pageSize: '300' });
    if (pageToken) qs.set('pageToken', pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/coupleSpots?${qs}`;
    const r = await http('GET', url, { Authorization: `Bearer ${token}`, 'User-Agent': UA });
    for (const d of (r.documents || [])) {
      const id = d.name.split('/').pop();
      const f = d.fields || {};
      const g = k => f[k]?.stringValue ?? null;
      out.push({ id, image: g('image'), nameEn: g('nameEn'), title: g('title'), city: g('city'), cityEn: g('cityEn') });
    }
    pageToken = r.nextPageToken || null;
  } while (pageToken);
  return out;
}

async function updateImageField(docId, imageUrl, token) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/coupleSpots/${docId}?updateMask.fieldPaths=image`;
  return http('PATCH', url, {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': UA,
  }, JSON.stringify({ fields: { image: { stringValue: imageUrl } } }));
}

// ── Wikipedia helpers ────────────────────────────────────────────────────
async function leadImage(title) {
  if (!title) return null;
  const url = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', prop: 'pageimages',
    titles: title, pithumbsize: '960', redirects: '1',
  });
  try {
    const data = await http('GET', url, { 'User-Agent': UA });
    for (const p of Object.values(data.query?.pages || {})) {
      if (p.missing !== undefined) continue;
      if (p.thumbnail?.source) return p.thumbnail.source.split('?')[0];
    }
  } catch (_) {}
  return null;
}

async function searchLeadImage(name) {
  if (!name) return null;
  const url = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', list: 'search', srsearch: name, srlimit: '3',
  });
  try {
    const data = await http('GET', url, { 'User-Agent': UA });
    for (const hit of (data.query?.search || [])) {
      await sleep(80);
      const img = await leadImage(hit.title);
      if (img) return img;
    }
  } catch (_) {}
  return null;
}

// Commons file search → thumbnail URL
async function commonsImage(name) {
  if (!name) return null;
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', generator: 'search',
    gsrsearch: `filetype:bitmap ${name}`, gsrnamespace: '6', gsrlimit: '1',
    prop: 'imageinfo', iiprop: 'url', iiurlwidth: '960',
  });
  try {
    const data = await http('GET', url, { 'User-Agent': UA });
    for (const p of Object.values(data.query?.pages || {})) {
      const ii = p.imageinfo?.[0];
      if (ii?.thumburl) return ii.thumburl.split('?')[0];
      if (ii?.url) return ii.url.split('?')[0];
    }
  } catch (_) {}
  return null;
}

// Derive an English-ish name from the doc id: strip leading city slug
function fromId(id, cityEn) {
  const words = s => s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const parts = id.split('-');
  const citySlug = (cityEn || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const cityParts = citySlug ? citySlug.split('-').filter(Boolean) : [parts[0]];
  let rest = parts;
  if (cityParts.length && parts.slice(0, cityParts.length).join('-') === cityParts.join('-')) {
    rest = parts.slice(cityParts.length);
  } else {
    rest = parts.slice(1);
  }
  if (!rest.length) rest = parts;
  return words(rest.join('-'));
}

async function main() {
  const token = await getToken();
  console.log('✓ token');
  const all = await listAllSpots(token);
  const missing = all.filter(s => !s.image || !String(s.image).trim());
  console.log(`total docs: ${all.length}, missing image: ${missing.length}`);

  const results = [];
  for (const s of missing) {
    const derived = fromId(s.id, s.cityEn);
    const candidates = [
      s.nameEn,
      derived,
      s.nameEn && s.cityEn ? `${s.nameEn} (${s.cityEn})` : null,
      s.cityEn && derived ? `${derived}, ${s.cityEn}` : null,
    ].filter(Boolean);

    let img = null, used = null;
    for (const c of candidates) {
      await sleep(100);
      img = await leadImage(c);
      if (img) { used = `lead:${c}`; break; }
    }
    if (!img) {
      const q = [s.nameEn || derived, s.cityEn].filter(Boolean).join(' ');
      await sleep(100);
      img = await searchLeadImage(q);
      if (img) used = `search:${q}`;
    }
    if (!img) {
      const q = [s.nameEn || derived, s.cityEn].filter(Boolean).join(' ');
      await sleep(100);
      img = await commonsImage(q);
      if (img) used = `commons:${q}`;
    }

    if (img) {
      try {
        await updateImageField(s.id, img, token);
        results.push({ ...s, image: img, via: used, ok: true });
        console.log(`✓ ${s.id} ← ${used}`);
      } catch (e) {
        results.push({ ...s, ok: false, err: e.message });
        console.log(`✗ UPD ${s.id}: ${e.message}`);
      }
    } else {
      results.push({ ...s, ok: false, err: 'no image found' });
      console.log(`✗ MISS ${s.id} (${s.nameEn || derived})`);
    }
  }

  writeFileSync('/tmp/fill-results.json', JSON.stringify(results, null, 2));

  // Update local spots.json for the ones we fixed
  const spotsPath = `${projectRoot}/src/data/couple/spots.json`;
  if (existsSync(spotsPath)) {
    const doc = JSON.parse(readFileSync(spotsPath, 'utf8'));
    const arr = Array.isArray(doc) ? doc : doc.spots;
    if (Array.isArray(arr)) {
      const byId = new Map(results.filter(r => r.ok).map(r => [r.id, r.image]));
      let n = 0;
      for (const s of arr) if (byId.has(s.id)) { s.image = byId.get(s.id); n++; }
      writeFileSync(spotsPath, JSON.stringify(doc, null, 2));
      console.log(`local spots.json: ${n} entries updated`);
    }
  }

  const ok = results.filter(r => r.ok).length;
  console.log(`\n=== checked ${missing.length}, updated ${ok}, failed ${missing.length - ok} ===`);
  for (const r of results.filter(r => !r.ok)) console.log(`FAIL ${r.id} | ${r.nameEn || ''} | ${r.title || ''} | ${r.err}`);
}

main().catch(e => { console.error(e); process.exit(1); });
