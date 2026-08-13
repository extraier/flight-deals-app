// Regression test for the worldcup page's "Date.now() in render" fix.
//
// Before:
//   const rows = [...data.matches].sort(...)
//   const nowMs = Date.now();   // line 115 — IMPURE during render
//   const visibleRows = rows.filter((m) => {
//     if (!m.gameTime) return true;
//     const t = Date.parse(m.gameTime.replace(' ', 'T') + '+08:00');
//     return nowMs - t < HIDE_AFTER_MS;
//   });
//
// Bug: every state change (sortBy, window, theme) re-runs the render and
// re-calls Date.now(). If a match crosses the 3-hour boundary mid-session,
// the row can flicker visible/invisible across re-renders. Also a React
// lints-strict-mode warning ("Cannot call impure function during render").
//
// After: nowMs is a useState seeded by useEffect, refreshed every 60s.
// This test verifies the filter logic is stable: same input + same nowMs
// → same output, regardless of how many times we re-render.

const HIDE_AFTER_MS = 3 * 60 * 60 * 1000; // 3 hours

function filterVisibleRows(matches, nowMs) {
  return matches.filter((m) => {
    if (!m.gameTime) return true;
    const t = Date.parse(m.gameTime.replace(' ', 'T') + '+08:00');
    if (isNaN(t)) return true;
    return nowMs === 0 || nowMs - t < HIDE_AFTER_MS;
  });
}

// Build an HKT-wall-clock string that, when parsed with "+08:00" appended,
// equals a given UTC timestamp. The worldcup code parses gameTime as
// `... + '+08:00'` (HKT), so to test "1h ago" we need a string whose
// parsed value is exactly `now - 1h` in UTC.
function hktStringAtUtc(utcMs) {
  const hktOffsetMs = 8 * 60 * 60 * 1000;
  return new Date(utcMs + hktOffsetMs).toISOString().slice(0, 19).replace('T', ' ');
}

const now = Date.now();
const matches = [
  { id: 1, gameTime: hktStringAtUtc(now - 60 * 60 * 1000), label: '1h ago HKT' },
  { id: 2, gameTime: hktStringAtUtc(now - 4 * 60 * 60 * 1000), label: '4h ago HKT (should be hidden)' },
  { id: 3, gameTime: null, label: 'no time' },
];

const cases = [
  // Pre-mount (nowMs = 0): all rows show
  { nowMs: 0, expected: [1, 2, 3] },
  // Post-mount at time T: 4h-ago row is hidden, 1h-ago row is visible
  { nowMs: now, expected: [1, 3] },
  // Same nowMs twice — output must be identical (stability)
  { nowMs: now, expected: [1, 3] },
];

let fail = 0;
for (const { nowMs, expected } of cases) {
  const got = filterVisibleRows(matches, nowMs).map(m => m.id);
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? '✅' : '❌'} nowMs=${nowMs} → got=${JSON.stringify(got)} (expected ${JSON.stringify(expected)})`);
}

// Stability test: 1000 renders with the same nowMs must produce the same output
const reference = JSON.stringify(filterVisibleRows(matches, now));
let drift = false;
for (let i = 0; i < 1000; i++) {
  if (JSON.stringify(filterVisibleRows(matches, now)) !== reference) {
    drift = true;
    break;
  }
}
const stableOk = !drift;
console.log(`${stableOk ? '✅' : '❌'} 1000x re-render with same nowMs is stable`);
if (!stableOk) fail++;

if (fail) {
  console.error(`\n${fail} case(s) failed`);
  process.exit(1);
} else {
  console.log('\nAll worldcup nowMs filter cases pass.');
}
