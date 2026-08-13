// Verify F-12 trailing-ads fix: distinct spots as separators
import { buildDeck } from '../src/lib/couple/cards';

const spot = (id) => ({
  id, kind: 'spot', name: id, city: '', country: '', region: '',
  image: '', blurb: '', tags: [], priceLevel: 1,
});
const ad = (id) => ({
  id, kind: 'ad', sponsor: '', title: id, image: '', body: '', ctaLabel: '',
  clickUrl: '', impressions: 0, clicks: 0, active: true,
});

function ids(deck) { return deck.map((c) => c.__kind === 'spot' ? `s:${c.id}` : `a:${c.id}`); }
function duplicates(deck) {
  const seen = new Map();
  for (const c of deck) {
    if (c.__kind !== 'spot') continue;
    seen.set(c.id, (seen.get(c.id) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1);
}

function check(name, spotsN, adsN) {
  const spots = Array.from({ length: spotsN }, (_, i) => spot(`s${i}`));
  const ads = Array.from({ length: adsN }, (_, i) => ad(`a${i}`));
  const deck = buildDeck(spots, ads, 42);
  const dups = duplicates(deck);
  const ok = dups.length === 0;
  console.log(
    `${ok ? '✅' : '❌'} ${name} (spots=${spotsN}, ads=${adsN}, len=${deck.length}):`,
    ids(deck).join(' '),
  );
  if (dups.length) console.log('   DUPES:', dups);
}

check('7 spots + 3 ads (original bug case)', 7, 3);
check('5 spots + 3 ads (max injection)', 5, 3);
check('5 spots + 5 ads', 5, 5);
check('1 spot + 3 ads (run out of distinct spots)', 1, 3);
check('24 spots + 3 ads (production)', 24, 3);
check('0 spots + 3 ads', 0, 3);
check('3 spots + 0 ads', 3, 0);
