// This directory used to host the standalone Serenity page. All Serenity
// content now lives as tabs inside /trump (see ../../trump/page.tsx).
//
// We keep this file as a minimal stub so Vercel's static prerender has
// something to serve at /serenity (returning null renders an empty page).
// Visitors should land on /trump and use the Serenity推文 / Serenity持股 tabs.

'use client';

export default function SerenityRemoved() {
  return null;
}
