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

const AD_INJECTION_FREQUENCY = 5; // 1 ad per 5 spots

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
 * ads after every 5th spot. Records `impressionIds` so a player doesn't see
 * the same ad twice in one session.
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

  const deck: DeckCard[] = [];
  let adCursor = 0;

  for (let i = 0; i < shuffledSpots.length; i++) {
    deck.push({ ...shuffledSpots[i], __kind: 'spot' });
    if ((i + 1) % AD_INJECTION_FREQUENCY === 0 && adCursor < availableAds.length) {
      deck.push({ ...availableAds[adCursor], __kind: 'ad' });
      adCursor++;
    }
  }

  // If any ads remain, append at the end (never two in a row, so first card still a spot)
  while (adCursor < availableAds.length) {
    deck.push({ ...availableAds[adCursor], __kind: 'ad' });
    adCursor++;
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
