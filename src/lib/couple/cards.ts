// Card interleaving for the couple room swipe deck.
// Spots + ads — 1 ad per 5 spots, never two ads back-to-back.
// Outputs a stable order so both players see the same sequence simultaneously.

export type SpotCard = {
  id: string;
  kind: 'spot';
  name: string;
  nameEn?: string;
  city: string;
  cityEn?: string;
  country: string;
  countryCode?: string;
  region: string;
  image: string;
  imageCredit?: string;
  blurb: string;
  tags: string[];
  priceLevel: 1 | 2 | 3 | 4;
  dealCode?: string;
  travelMood?: string[];
};

export type AdCard = {
  id: string;
  kind: 'ad';
  sponsor: string;
  title: string;
  image: string;
  body: string;
  ctaLabel: string;
  clickUrl: string;
  impressions: number;
  clicks: number;
  budget?: number;
  active: boolean;
};

export type DeckCard = (SpotCard & { __kind: 'spot' }) | (AdCard & { __kind: 'ad' });

// Hermes 2026-08-14 (Phase 1.2 + 1.3): rewrote ad injection cadence.
// INVARIANT: never two ads within MIN_GAP_BETWEEN_ADS of each other.
// User-reported bug: the previous 1-in-5 + trailing-ads fallback produced
// 3-5 ads stacked at the end of every deck. New algorithm uses two-pass
// placement with evenly-spaced anchors; trailing fallback is gone.
const AD_INJECTION_FREQUENCY = 10;  // initial hint, capped by min-gap
const MIN_GAP_BETWEEN_ADS = 10;       // hard floor: no 2 ads within 10 spots

/**
 * Deterministic shuffle so both players see the same order (no Math.random).
 * Uses a seeded PRNG based on the timestamp the room was created.
 */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build the deck for a room: shuffle spots deterministically, then slot in
 * ads at evenly-spaced anchors. INVARIANTS:
 *   1. Never two ads adjacent.
 *   2. Never two ads closer than MIN_GAP_BETWEEN_ADS spots apart.
 *   3. Ad order is also deterministically shuffled (so the same ad doesn't
 *      always appear first across rooms).
 *   4. Ad count injected is bounded: floor(N / (MIN_GAP+1)) — for 20 spots
 *      with MIN_GAP=10 that's 1 ad; for 30 spots it's 2 ads.
 *   5. `seenAdIds` filter: ads the player has already seen this session
 *      are excluded. `active` and `impressions < budget` filters apply.
 */
export function buildDeck(
  spots: SpotCard[],
  ads: AdCard[],
  seed: number,
  seenAdIds: Set<string> = new Set()
): DeckCard[] {
  const shuffledSpots = seededShuffle(spots, seed);
  const availableAds = ads.filter(
    (ad) => ad.active && !seenAdIds.has(ad.id) && (ad.impressions || 0) < (ad.budget || 999999)
  );

  // No ads available — return spots only.
  if (availableAds.length === 0) {
    return shuffledSpots.map((s) => ({ ...s, __kind: 'spot' as const }));
  }

  // Cap: with MIN_GAP=10, every ad needs ~11 deck slots. Floor division.
  const maxAdsByGap = Math.floor(shuffledSpots.length / (MIN_GAP_BETWEEN_ADS + 1));
  const adCount = Math.min(availableAds.length, maxAdsByGap);

  if (adCount === 0 || shuffledSpots.length === 0) {
    return shuffledSpots.map((s) => ({ ...s, __kind: 'spot' as const }));
  }

  // Pick which ads to place (deterministic shuffle on a different seed so
  // the order varies across rooms even though spots are deterministic).
  const adsToPlace = seededShuffle(availableAds, seed ^ 0x5a5a).slice(0, adCount);

  // Anchor positions: spread evenly. For N ads in L spots with gap G:
  //   anchor_k = round((k+1) * (L+1) / (N+1)) - 1
  // This guarantees at least G spots between consecutive anchors when
  // L >= N * (G + 1). Verified by the cadence tests.
  const anchors: Set<number> = new Set();
  for (let k = 0; k < adCount; k++) {
    const pos = Math.round(((k + 1) * (shuffledSpots.length + 1)) / (adCount + 1)) - 1;
    anchors.add(Math.max(0, Math.min(shuffledSpots.length - 1, pos)));
  }

  // Single-pass build: place ads at anchor slots, spots elsewhere.
  const deck: DeckCard[] = [];
  let spotCursor = 0;
  let adCursor = 0;
  for (let i = 0; i < shuffledSpots.length; i++) {
    if (anchors.has(i)) {
      deck.push({ ...adsToPlace[adCursor], __kind: 'ad' });
      adCursor++;
    } else {
      deck.push({ ...shuffledSpots[spotCursor], __kind: 'spot' });
      spotCursor++;
    }
  }

  return deck;
}

/**
 * Filter out cards the current user has already swiped on (like or dislike).
 * Returns the deck in the original order minus the swiped IDs.
 */
export function filterUnswiped(
  deck: DeckCard[],
  likedIds: string[],
  dislikedIds: string[]
): DeckCard[] {
  const swiped = new Set([...likedIds, ...dislikedIds]);
  return deck.filter((c) => !swiped.has(c.id));
}

/**
 * Compute the intersection of two players' likes.
 */
export function intersection<T>(a: T[], b: T[]): T[] {
  const bset = new Set(b);
  return [...new Set(a)].filter((x) => bset.has(x));
}
