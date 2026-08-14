// Phase 1.1 — cadence tests for buildDeck().
// Uses Node's built-in node:test (no extra deps).
// Run with: npm run test:cards
//
// Asserts the invariants the new buildDeck() must satisfy:
//   1. No two ads are adjacent in the output deck.
//   2. At least MIN_GAP_BETWEEN_ADS (10) spots between any two consecutive ads.
//   3. Total ad count injected is bounded (no over-injection for small decks).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck, type SpotCard, type AdCard } from '../cards.ts';

const spots20: SpotCard[] = Array.from({ length: 20 }, (_, i) => ({
  id: `s${i}`,
  kind: 'spot',
  name: `Spot ${i}`,
  city: 'C',
  country: 'X',
  region: 'R',
  image: '',
  blurb: '',
  tags: [],
  priceLevel: 1,
}));

const ads5: AdCard[] = Array.from({ length: 5 }, (_, i) => ({
  id: `a${i}`,
  kind: 'ad',
  sponsor: 'S',
  title: `Ad ${i}`,
  image: '',
  body: '',
  ctaLabel: 'go',
  clickUrl: 'https://x.com',
  impressions: 0,
  clicks: 0,
  active: true,
}));

test('buildDeck: no two ads adjacent in a 20-spot / 5-ad deck', () => {
  const deck = buildDeck(spots20, ads5, 42);
  let lastWasAd = false;
  for (const c of deck) {
    if (c.__kind === 'ad') {
      assert.equal(lastWasAd, false, 'two ads appeared back-to-back');
      lastWasAd = true;
    } else {
      lastWasAd = false;
    }
  }
});

test('buildDeck: at least 10 spots between any two consecutive ads', () => {
  const deck = buildDeck(spots20, ads5, 42);
  const adIdx: number[] = [];
  deck.forEach((c, i) => {
    if (c.__kind === 'ad') adIdx.push(i);
  });
  for (let i = 1; i < adIdx.length; i++) {
    const gap = adIdx[i] - adIdx[i - 1] - 1; // number of spots between
    assert.ok(gap >= 10, `gap of ${gap} spots between ads at idx ${adIdx[i - 1]} and ${adIdx[i]} violates min-gap`);
  }
});

test('buildDeck: total deck length = spots.length (ads replace spots at anchor slots, not appended)', () => {
  const deck = buildDeck(spots20, ads5, 42);
  // Ads sit IN PLACE OF spots at evenly-spaced anchors — they don't add
  // to the deck length. The total deck is always exactly spots.length.
  assert.equal(deck.length, spots20.length);
});

test('buildDeck: with 5 ads and 20 spots, inject exactly 1 ad (floor(20/11) = 1)', () => {
  const deck = buildDeck(spots20, ads5, 42);
  // cap = floor(N / (MIN_GAP+1)) = floor(20 / 11) = 1
  const adCount = deck.filter((c) => c.__kind === 'ad').length;
  assert.equal(adCount, 1, `expected 1 ad in 20 spots, got ${adCount}`);
});

test('buildDeck: with 5 ads and 30 spots, inject exactly 2 ads (floor(30/11) = 2)', () => {
  const spots30 = spots20.concat(Array.from({ length: 10 }, (_, i) => ({
    ...spots20[0], id: `extra${i}`,
  })));
  const deck = buildDeck(spots30, ads5, 42);
  const adCount = deck.filter((c) => c.__kind === 'ad').length;
  assert.equal(adCount, 2, `expected 2 ads in 30 spots, got ${adCount}`);
});

test('buildDeck: with no ads, returns all spots in shuffled order', () => {
  const deck = buildDeck(spots20, [], 42);
  assert.equal(deck.length, 20);
  for (const c of deck) {
    assert.equal(c.__kind, 'spot');
  }
});

test('buildDeck: respects seenAdIds (already-seen ads not injected)', () => {
  const seen = new Set(['a0', 'a1']);
  const deck = buildDeck(spots20, ads5, 42, seen);
  // Should only inject from a2, a3, a4 — still cap at 2 by min-gap
  const adIds = deck.filter((c) => c.__kind === 'ad').map((c) => c.id);
  for (const id of adIds) {
    assert.ok(!seen.has(id), `seen ad ${id} was re-injected`);
  }
});

test('buildDeck: respects active=false filter', () => {
  const ads = ads5.map((a, i) => ({ ...a, active: i < 2 }));
  const deck = buildDeck(spots20, ads, 42);
  // Only a0, a1 are active. Max 2 can inject.
  const adIds = deck.filter((c) => c.__kind === 'ad').map((c) => c.id);
  for (const id of adIds) {
    assert.ok(id === 'a0' || id === 'a1', `inactive ad ${id} was injected`);
  }
});
