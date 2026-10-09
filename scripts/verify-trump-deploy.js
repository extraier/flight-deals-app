/**
 * verify-trump-deploy.js
 *
 * Post-deploy gate: confirms flight-deals-app-seven.vercel.app/trump actually
 * serves the new JSON we just committed. If not, alerts and prints the
 * Vercel alias fix command.
 *
 * Why: Vercel auto-tracks production for some aliases but NOT for manually-set
 * ones. When a custom (or *.vercel.app) domain is pinned to an old deployment,
 * the new code never reaches the user's URL — the GitHub commit, the Vercel
 * build, and the JSON file are all correct, but the domain keeps serving stale
 * HTML. This script catches that case within ~60s of the deploy completing.
 *
 * Trigger: optional, after fetch-trump-data.js + a Vercel production deploy.
 *   Hermes detect heuristic: if the latest local JSON `updated` is newer than the
 *   page's last quoted data marker (e.g. "2026-07-01" present but no "2026-08-31"),
 *   the alias is stale.
 *
 * Usage:
 *   node scripts/verify-trump-deploy.js [--url=https://flight-deals-app-seven.vercel.app/trump]
 *
 * Exit code 0 = verified live, 1 = stale alias (printed fix recipe).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'src', 'data', 'trump_alerts.json');

const args = process.argv.slice(2);
const urlArg = args.find((a) => a.startsWith('--url='));
const TARGET_URL = urlArg ? urlArg.slice('--url='.length) : 'https://flight-deals-app-seven.vercel.app/trump';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function main() {
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`[verify] missing ${JSON_PATH}`);
    process.exit(2);
  }
  const local = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const newestFiled = local.quiver_trades?.[0]?.filed;
  const newestTraded = local.quiver_trades?.[0]?.traded;
  if (!newestFiled) {
    console.error('[verify] local JSON has no trades');
    process.exit(2);
  }

  console.log(`[verify] local newest filed=${newestFiled} traded=${newestTraded}`);

  const res = await fetch(TARGET_URL, { headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' } });
  if (!res.ok) {
    console.error(`[verify] HTTP ${res.status} from ${TARGET_URL}`);
    process.exit(2);
  }
  const html = await res.text();
  const cache = res.headers.get('x-vercel-cache');
  const age = res.headers.get('age');
  console.log(`[verify] live cache=${cache} age=${age}`);

  const tradedYyyyMm = newestTraded.slice(0, 7); // e.g. "2026-08"
  const filedYyyyMm = newestFiled.slice(0, 7);
  const tradedCount = (html.match(new RegExp(newestTraded, 'g')) || []).length;
  const filedCount = (html.match(new RegExp(newestFiled, 'g')) || []).length;
  const tradedMonthCount = (html.match(new RegExp(tradedYyyyMm, 'g')) || []).length;
  const filedMonthCount = (html.match(new RegExp(filedYyyyMm, 'g')) || []).length;

  console.log(
    `[verify] live html contains ${newestTraded}: ${tradedCount}x, ${newestFiled}: ${filedCount}x`,
  );

  // Heuristic for stale alias: page is missing the newest traded date AND the
  // newest traded month, but the cache is HIT (not PRERENDER).
  const stale =
    cache === 'HIT' && tradedCount === 0 && tradedMonthCount === 0 && filedCount === 0 && filedMonthCount === 0;

  if (stale) {
    console.error('');
    console.error('STALE ALIAS DETECTED');
    console.error('The latest JSON is committed, but the live URL still serves old HTML.');
    console.error('The custom-domain / *.vercel.app alias is pinned to a previous deployment.');
    console.error('Fix is to re-attach the alias to the latest deployment.');
    console.error('');
    console.error('Fix command:');
    console.error('  curl -sS -X POST \\');
    console.error('    "https://api.vercel.com/v2/deployments/<NEW_DEPLOY_ID>/aliases" \\');
    console.error('    -H "Authorization: Bearer $VERCEL_TOKEN" \\');
    console.error('    -H "Content-Type: application/json" \\');
    const aliasHost = new URL(TARGET_URL).host;
    console.error(`    -d '{"alias": "${aliasHost}", "teamId": "<TEAM_ID>"}'`);
    console.error('');
    console.error('Get the new deployment ID via:');
    console.error('  gh api "repos/extraier/flight-deals-app/deployments?per_page=1"');
    console.error('  # or: curl -H "Authorization: Bearer $VERCEL_TOKEN" \\');
    console.error('  #      "https://api.vercel.com/v6/deployments?teamId=<TEAM_ID>&projectId=<PROJECT_ID>&limit=1&target=production"');
    process.exit(1);
  }

  console.log('[verify] live URL matches local JSON — alias is current');
  process.exit(0);
}

main().catch((e) => {
  console.error('[verify] FATAL', e);
  process.exit(2);
});