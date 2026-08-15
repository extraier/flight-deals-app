'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin, Heart, X, Rocket, Ban, Sparkles } from 'lucide-react';
import type { DeckCard } from '@/lib/couple/cards';

const REGION_COLORS: Record<string, string> = {
  '東亞': 'bg-sky-500/30 text-sky-100 border-sky-300/40',
  '東南亞': 'bg-amber-500/30 text-amber-100 border-amber-300/40',
  '中國': 'bg-red-500/30 text-red-100 border-red-300/40',
  '大洋洲': 'bg-cyan-500/30 text-cyan-100 border-cyan-300/40',
  '香港': 'bg-pink-500/30 text-pink-100 border-pink-300/40',
  '歐洲': 'bg-violet-500/30 text-violet-100 border-violet-300/40',
  '北美洲': 'bg-orange-500/30 text-orange-100 border-orange-300/40',
  '南亞': 'bg-yellow-500/30 text-yellow-100 border-yellow-300/40',
  '中東': 'bg-emerald-500/30 text-emerald-100 border-emerald-300/40',
  '非洲': 'bg-yellow-500/30 text-yellow-100 border-yellow-300/40',
  '南美洲': 'bg-orange-500/30 text-orange-100 border-orange-300/40',
};

const PRICE_LABEL: Record<number, string> = {
  1: '$ 經濟',
  2: '$$ 舒適',
  3: '$$$ 高級',
  4: '$$$$ 奢華',
};

const PRICE_COLOR: Record<number, string> = {
  1: 'bg-green-500/30 text-green-100 border-green-300/40',
  2: 'bg-blue-500/30 text-blue-100 border-blue-300/40',
  3: 'bg-purple-500/30 text-purple-100 border-purple-300/40',
  4: 'bg-rose-500/30 text-rose-100 border-rose-300/40',
};

export function SpotCard({
  card,
  onSwipe,
  dragOffset,
  isDragging,
  onDragStart,
  onDragMove,
  onDragEnd,
  zIndex,
  isBackground = false,
  onToggleWishlist,
  savedToWishlist = false,
  // Hermes 2026-08-14 (screenshot 6): parent (SwipeDeck) passes a custom
  // height style. Used to override the default h-[60vh] max-h-[600px] with
  // a calc(100svh - X) that adapts to the actual viewport height on
  // iOS Safari (which has a dynamic bottom toolbar).
  heightStyle,
}: {
  card: DeckCard;
  onSwipe?: (direction: 'left' | 'right') => void;
  dragOffset?: { x: number; y: number };
  isDragging?: boolean;
  onDragStart?: (e: React.PointerEvent) => void;
  onDragMove?: (e: React.PointerEvent) => void;
  onDragEnd?: () => void;
  zIndex: number;
  isBackground?: boolean;
  onToggleWishlist?: (card: DeckCard) => void;
  savedToWishlist?: boolean;
  heightStyle?: React.CSSProperties;
}) {
  const isAd = card.__kind === 'ad';
  const dx = dragOffset?.x ?? 0;
  const dy = dragOffset?.y ?? 0;
  const rotate = dx * 0.05;

  // Hermes 2026-08-14: shared frame styles. The card has explicit width +
  // height so it doesn't collapse. Centering is done by the WRAPPER div
  // (in SwipeDeck), not by this card — the card's only job is to fill its
  // wrapper. The wrapper uses flexbox justify-center items-center to
  // center us, then we add drag/rotation via the inline transform.
  //
  // Layout strategy (after user screenshot 3):
  //   - Card has explicit h-[70vh] max-h-[640px] (defined box — no collapse)
  //   - w-[88%] max-w-sm (fits narrow phones, caps on landscape)
  //   - 4px solid pink border (visible "framed photo" look)
  const frameShell =
    'relative w-full max-w-sm rounded-3xl bg-gray-900 shadow-2xl overflow-hidden border-4 border-pink-500 select-none touch-none';
  const imageLayer = 'w-full h-full bg-cover bg-center';

  if (isAd) {
    const ad = card;
    // Hermes 2026-08-14 (screenshot 5): same image fix as the spot card —
    // encodeURI + CSS-quote-wrap the URL, fall back to a gradient if empty.
    const safeAdUrl = (() => {
      const url = ad.image;
      if (!url || typeof url !== 'string') return '';
      try {
        return encodeURI(url);
      } catch {
        return url;
      }
    })();
    const hasAdImage = safeAdUrl.length > 0;

    return (
      <div
        // Hermes 2026-08-14: explicit h-[60vh] + max-h-[600px] gives the
        // card a defined box (no zero-height collapse). w-full inherits
        // from the parent's w-[88%] wrapper.
        // Hermes 2026-08-14 (screenshot 6): if parent passed a heightStyle,
        // use that instead (calc(100svh - X) — adapts to viewport).
        className={`${frameShell} ${heightStyle ? '' : 'h-[60vh] max-h-[600px]'} border-blue-500`}
        style={{
          ...heightStyle,
          transform: `translate(${dx}px, ${dy}px) rotate(${rotate}deg)`,
          transition: isDragging ? 'none' : 'transform 0.3s ease-out',
          zIndex,
        }}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerLeave={onDragEnd}
      >
        {hasAdImage && (
          <div
            className={imageLayer}
            style={{ backgroundImage: `url("${safeAdUrl}")` }}
          />
        )}
        {!hasAdImage && (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-700 via-indigo-700 to-purple-800">
            <Rocket size={48} className="text-white/80" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-blue-950/95 via-blue-900/50 to-transparent" />
        <div className="absolute top-4 left-4 right-4 flex flex-wrap gap-2 z-10">
          <span className="px-3 py-1.5 bg-blue-500/90 backdrop-blur-md rounded-full text-white text-xs font-bold shadow-lg">
            廣告 · {ad.sponsor}
          </span>
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
          <h2 className="text-2xl font-black drop-shadow-md mb-2">{ad.title}</h2>
          <p className="text-sm font-medium mb-4 opacity-90">{ad.body}</p>
          <div className="flex items-center gap-2 text-xs opacity-80">
            <Sparkles size={14} /> 點擊右滑查看優惠
          </div>
        </div>
        {dx > 20 && (
          <div
            className="absolute top-20 left-8 border-4 border-green-400 text-green-400 font-black text-3xl p-2 rounded-lg transform -rotate-12 z-20"
            style={{ opacity: Math.min(dx / 100, 1) }}
          >
            查看
          </div>
        )}
        {dx < -20 && (
          <div
            className="absolute top-20 right-8 border-4 border-red-500 text-red-500 font-black text-3xl p-2 rounded-lg transform rotate-12 z-20"
            style={{ opacity: Math.min(Math.abs(dx) / 100, 1) }}
          >
            略過
          </div>
        )}
      </div>
    );
  }

  const spot = card;
  const regionColor = REGION_COLORS[spot.region] || 'bg-slate-500/30 text-slate-100 border-slate-300/40';
  const priceColor = PRICE_COLOR[spot.priceLevel] || PRICE_COLOR[2];

  // Hermes 2026-08-14 (screenshot 5): card had no visible image — the
  // backgroundImage: url(${spot.image}) style is fragile:
  //   1. If spot.image is undefined/null/empty, the style is "url()" and CSS
  //      silently does nothing → just shows the gray bg + gradient.
  //   2. If the URL contains parens, commas, or unescaped quotes, CSS breaks.
  //   3. If the image 404s, we want a graceful fallback (still readable).
  //
  // Fix: encodeURI the URL, wrap in CSS quotes, AND add an emoji fallback
  // so empty/broken images still show *something* thematic.
  const safeImageUrl = (() => {
    const url = spot.image;
    if (!url || typeof url !== 'string') return '';
    try {
      return encodeURI(url);
    } catch {
      return url;
    }
  })();
  const hasImage = safeImageUrl.length > 0;

  return (
    <div
      // Hermes 2026-08-14: explicit h-[60vh] (capped at 600px) gives the
      // card a defined box. The parent wrapper (SwipeDeck) provides the
      // centered positioning via flexbox. Drag/rotation is applied via
      // the inline transform.
      // Hermes 2026-08-14 (screenshot 6): if parent passed a heightStyle,
      // use that instead (calc(100svh - X) — adapts to viewport).
      className={`${frameShell} ${heightStyle ? '' : 'h-[60vh] max-h-[600px]'}`}
      style={{
        ...heightStyle,
        transform: `translate(${dx}px, ${dy}px) rotate(${rotate}deg)`,
        transition: isDragging ? 'none' : 'transform 0.3s ease-out',
        zIndex,
      }}
      onPointerDown={onDragStart}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onPointerLeave={onDragEnd}
    >
      {hasImage && (
        <div
          // Hermes 2026-08-14 (screenshot 5): background-image with a quote-
          // wrapped, encodeURI'd URL so parens / spaces / non-ASCII chars
          // don't break the CSS parser. bg-cover + bg-center crops without
          // distorting aspect ratio. The container already has overflow-
          // hidden + rounded-3xl so the photo respects the rounded frame.
          className={imageLayer}
          style={{
            backgroundImage: `url("${safeImageUrl}")`,
          }}
        />
      )}
      {!hasImage && (
        // Hermes 2026-08-14 (screenshot 5): empty image fallback. A subtle
        // gradient with the city emoji keeps the card readable instead of
        // rendering as a blank dark rectangle.
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-pink-700 via-purple-700 to-indigo-800">
          <span className="text-7xl mb-2" aria-hidden>
            🌍
          </span>
          <span className="text-white/80 text-xs font-medium px-3 text-center">
            {spot.city || spot.name || '目的地'}
          </span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-pink-950/95 via-black/30 to-transparent" />

      <div className="absolute top-4 left-4 right-4 flex flex-wrap gap-2 z-10">
        <span className={`px-3 py-1.5 backdrop-blur-md rounded-full text-xs font-bold shadow-lg border ${regionColor}`}>
          {spot.region}
        </span>
        <span className="px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-full text-white text-xs font-bold shadow-lg flex items-center gap-1">
          <MapPin size={12} className="text-pink-400" />
          {spot.city}
        </span>
        <span className={`px-3 py-1.5 backdrop-blur-md rounded-full text-xs font-bold shadow-lg border ${priceColor}`}>
          {PRICE_LABEL[spot.priceLevel] || PRICE_LABEL[2]}
        </span>
        {onToggleWishlist && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleWishlist(card);
            }}
            className={`ml-auto p-2 rounded-full backdrop-blur-md shadow-lg transition ${
              savedToWishlist
                ? 'bg-pink-500 text-white'
                : 'bg-black/60 text-white/80 hover:bg-black/80'
            }`}
            aria-label={savedToWishlist ? '從心願清單移除' : '加入心願清單'}
          >
            <Heart size={16} className={savedToWishlist ? 'fill-current' : ''} />
          </button>
        )}
      </div>

      {dx > 20 && (
        <div
          className="absolute top-1/3 left-8 border-4 border-green-400 text-green-400 font-black text-4xl p-3 rounded-lg transform -rotate-12 z-20"
          style={{ opacity: Math.min(dx / 100, 1) }}
        >
          LIKE
        </div>
      )}
      {dx < -20 && (
        <div
          className="absolute top-1/3 right-8 border-4 border-red-500 text-red-500 font-black text-4xl p-3 rounded-lg transform rotate-12 z-20"
          style={{ opacity: Math.min(Math.abs(dx) / 100, 1) }}
        >
          NOPE
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
        <h2 className="text-3xl font-black drop-shadow-lg mb-1">{spot.name}</h2>
        <p className="text-sm font-medium mb-3 opacity-90">
          {spot.country} {spot.nameEn && `· ${spot.nameEn}`}
        </p>
        <p className="text-sm leading-relaxed mb-3 opacity-80">{spot.blurb}</p>
        {spot.tags && spot.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {spot.tags.map((tag: string) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-white/10 backdrop-blur-md rounded-full text-[10px] font-medium"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
