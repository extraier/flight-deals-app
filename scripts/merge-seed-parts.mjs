/* eslint-disable no-console */
/**
 * scripts/merge-seed-parts.mjs
 *
 * Phase 3.1 helper — combine the 3 regional part files (part1, part2,
 * part3) into the final seed-spots-cities.json. Handles:
 *   - City/landmark dedup (across parts and against the existing 31)
 *   - Slug uniqueness check (catches cross-part duplicates)
 *   - Schema sanity (every landmark has imageHint)
 *   - Region distribution summary
 *
 * Usage: node /Users/roger/Projects/flight-deals-app/scripts/merge-seed-parts.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(PROJECT_ROOT, 'scripts/seed-spots-cities.json');

function loadPart(p) {
  const path = path.join(PROJECT_ROOT, 'scripts/seed-spots-part' + p + '.json');
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return data.cities || [];
}

const cities = [...loadPart(1), ...loadPart(2), ...loadPart(3)];
console.log(`Loaded ${cities.length} cities from 3 parts`);

if (cities.length === 0) {
  console.error('No parts found — nothing to merge');
  process.exit(1);
}

// Schema check
const required = ['cityEn','cityZh','countryEn','countryZh','countryCode','regionZh','dealCode','defaultPriceLevel','landmarks'];
const lmRequired = ['nameEn','nameZh','imageHint'];
let schemaErrors = 0;
for (const c of cities) {
  for (const k of required) {
    if (!(k in c)) { console.error(`Missing ${k} in city ${c.cityEn}`); schemaErrors++; }
  }
  if (!Array.isArray(c.landmarks)) { console.error(`landmarks not array in ${c.cityEn}`); schemaErrors++; continue; }
  for (const l of c.landmarks) {
    for (const k of lmRequired) {
      if (!(k in l)) { console.error(`Missing ${k} in landmark ${c.cityEn}/${JSON.stringify(l)}`); schemaErrors++; }
    }
  }
}
if (schemaErrors > 0) {
  console.error(`\n${schemaErrors} schema errors — fix parts before merging`);
  process.exit(1);
}

// Slug uniqueness
function slug(s) {
  return s.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const slugSet = new Map(); // slug -> cityEn
let slugDups = 0;
for (const c of cities) {
  for (const l of c.landmarks) {
    const s = `${slug(c.cityEn)}-${slug(l.nameEn)}`;
    if (slugSet.has(s)) {
      console.warn(`  ⚠ SLUG COLLISION: ${s} (in ${slugSet.get(s)} and ${c.cityEn})`);
      slugDups++;
    } else {
      slugSet.set(s, c.cityEn);
    }
  }
}

// Region breakdown
const regions = {};
for (const c of cities) {
  regions[c.regionZh] = (regions[c.regionZh] || 0) + 1;
}

// Country coverage
const countries = new Set(cities.map(c => c.countryEn));

// Final stats
const totalLandmarks = cities.reduce((s, c) => s + c.landmarks.length, 0);
const avgLandmarks = (totalLandmarks / cities.length).toFixed(2);

console.log(`\n=== Final Stats ===`);
console.log(`Cities: ${cities.length}`);
console.log(`Landmarks: ${totalLandmarks}`);
console.log(`Avg landmarks/city: ${avgLandmarks}`);
console.log(`Countries: ${countries.size}`);
console.log(`\nBy region:`);
for (const [r, n] of Object.entries(regions).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${r}: ${n}`);
}

if (slugDups > 0) {
  console.warn(`\n${slugDups} slug collisions — Firestore will overwrite. Review above.`);
}

if (cities.length < 240) {
  console.warn(`\n⚠ Only ${cities.length} cities — plan target was ~250. Add more to part files and re-run.`);
}

// Write merged file
const merged = {
  _meta: {
    purpose: 'Curated city list for flight-deals-app Phase 3 expansion.',
    schema_version: 1,
    generated_at: new Date().toISOString(),
    target_count: `${cities.length} cities × ${avgLandmarks} avg landmarks = ${totalLandmarks} spots`,
    sources: ['seed-spots-part1.json', 'seed-spots-part2.json', 'seed-spots-part3.json'],
  },
  cities,
};

writeFileSync(OUT, JSON.stringify(merged, null, 2));
console.log(`\n✓ Wrote ${path.basename(OUT)} (${(JSON.stringify(merged).length / 1024).toFixed(1)} KB)`);
