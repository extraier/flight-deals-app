// Hermes 2026-09-29: smoke test for the cooldown override logic in buildDropList.
// Verifies that a row matching a cooldown entry gets its dropAmount/dropPct/
// oldPrice/firstDetected overridden with the cooldown's stamped fingerprint.
//
// Run with: cd src/app/deals && npx tsx test_cooldown_override.ts
// Or extract the regex/inline logic into a pure function and test it.

// Inline copy of the override logic for verification.
interface DropRow {
  route: string;
  destCode: string;
  destName: string;
  oldPrice: number;
  newPrice: number;
  dropAmount: number;
  dropPct: number;
  typicalPrice: number;
  firstDetected: string | null;
  comparisonSource: 'yesterday' | 'typical' | 'cooldown';
  cheapestDate: { day: number; month: number; year: number; airline?: string; dep_time?: string };
}

interface CooldownEntry {
  amount: number | null;
  pct: number | null;
  price: number | null;
  ts: string | null;
}

function buildIndex(cooldown: Record<string, CooldownEntry>): Map<string, { entry: CooldownEntry; ageMs: number }> {
  const map = new Map<string, { entry: CooldownEntry; ageMs: number }>();
  const nowMs = Date.now();
  for (const [key, c] of Object.entries(cooldown)) {
    if (!c?.ts) continue;
    const ageMs = nowMs - new Date(c.ts).getTime();
    if (ageMs < 0 || ageMs > 86400000) continue;
    const m = key.match(/([^→\s]+(?:\s[^→\s]+)*)\s*\(([A-Z]{3})\)\s*$/);
    if (!m) continue;
    const destName = `${m[1]} (${m[2]})`;
    if (!map.has(destName)) map.set(destName, { entry: c, ageMs });
  }
  return map;
}

function applyOverride(row: DropRow, match: { entry: CooldownEntry } | undefined): DropRow {
  if (!match) return row;
  const cd = match.entry;
  let absAmount: number;
  let absPct: number;
  if (typeof cd.amount === 'number' && typeof cd.pct === 'number' && cd.amount !== 0 && cd.pct !== 0) {
    absAmount = Math.abs(cd.amount);
    absPct = Math.abs(Math.round(cd.pct * 10) / 10);
  } else if (row.typicalPrice > 0 && row.newPrice > 0 && row.typicalPrice > row.newPrice) {
    absAmount = row.typicalPrice - row.newPrice;
    absPct = Math.round((absAmount / row.typicalPrice) * 1000) / 10;
  } else {
    return row;
  }
  return {
    ...row,
    dropAmount: absAmount,
    dropPct: absPct,
    oldPrice: row.newPrice + absAmount,
    firstDetected: cd.ts,
    comparisonSource: 'cooldown',
  };
}

// Tests
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('  ok:', msg);
}

console.log('Test 1: stamped fingerprint overrides');
{
  const cd: Record<string, CooldownEntry> = {
    'HKG→UO→廣島 (HIJ)': { amount: -420, pct: -17.2, price: 2025, ts: new Date().toISOString() },
  };
  const idx = buildIndex(cd);
  const row: DropRow = {
    route: 'HKG→HIJ',
    destCode: 'HIJ',
    destName: '廣島 (HIJ)',
    oldPrice: 0,
    newPrice: 2025,
    dropAmount: 0,
    dropPct: 0,
    typicalPrice: 3283,
    firstDetected: null,
    comparisonSource: 'typical',
    cheapestDate: { day: 3, month: 10, year: 2026 },
  };
  const out = applyOverride(row, idx.get('廣島 (HIJ)'));
  assert(out.dropAmount === 420, `dropAmount should be 420 (was ${out.dropAmount})`);
  assert(out.dropPct === 17.2, `dropPct should be 17.2 (was ${out.dropPct})`);
  assert(out.oldPrice === 2445, `oldPrice should be 2445 (was ${out.oldPrice})`);
  assert(out.firstDetected === cd['HKG→UO→廣島 (HIJ)'].ts, 'firstDetected should be set');
  assert(out.comparisonSource === 'cooldown', 'comparisonSource should be cooldown');
}

console.log('Test 2: null fingerprint falls back to typicalPrice');
{
  const cd: Record<string, CooldownEntry> = {
    'HKG→UO→廣島 (HIJ)': { amount: null, pct: null, price: null, ts: new Date().toISOString() },
  };
  const idx = buildIndex(cd);
  const row: DropRow = {
    route: 'HKG→HIJ',
    destCode: 'HIJ',
    destName: '廣島 (HIJ)',
    oldPrice: 0,
    newPrice: 2029,
    dropAmount: 0,
    dropPct: 0,
    typicalPrice: 3283,
    firstDetected: null,
    comparisonSource: 'typical',
    cheapestDate: { day: 28, month: 10, year: 2026 },
  };
  const out = applyOverride(row, idx.get('廣島 (HIJ)'));
  assert(out.dropAmount === 1254, `dropAmount should be 1254 (was ${out.dropAmount})`);
  assert(out.dropPct === 38.2, `dropPct should be 38.2 (was ${out.dropPct})`);
  assert(out.oldPrice === 3283, `oldPrice should be 3283 (was ${out.oldPrice})`);
}

console.log('Test 3: stale (>24h) cooldown entry is ignored');
{
  const cd: Record<string, CooldownEntry> = {
    'HKG→UO→廣島 (HIJ)': { amount: -100, pct: -10, price: 900, ts: new Date(Date.now() - 25 * 3600 * 1000).toISOString() },
  };
  const idx = buildIndex(cd);
  const row: DropRow = {
    route: 'HKG→HIJ',
    destCode: 'HIJ',
    destName: '廣島 (HIJ)',
    oldPrice: 0,
    newPrice: 900,
    dropAmount: 0,
    dropPct: 0,
    typicalPrice: 1000,
    firstDetected: null,
    comparisonSource: 'typical',
    cheapestDate: { day: 1, month: 10, year: 2026 },
  };
  const out = applyOverride(row, idx.get('廣島 (HIJ)'));
  assert(out.dropAmount === 0, `stale cooldown should NOT override (dropAmount=${out.dropAmount})`);
}

console.log('Test 4: airline-prefixed key (UO:HKG→…) parses same as HKG→UO→…');
{
  const cd: Record<string, CooldownEntry> = {
    'UO:HKG→廣島 (HIJ)': { amount: -500, pct: -20, price: 2000, ts: new Date().toISOString() },
  };
  const idx = buildIndex(cd);
  assert(idx.has('廣島 (HIJ)'), 'should index airline-prefixed key');
}

console.log('All tests passed');
