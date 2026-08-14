'use client';

import { useEffect, useRef, useState } from 'react';
import { Heart, X, Rocket, Ban, Undo2 } from 'lucide-react';
import { SpotCard } from './SpotCard';
import type { DeckCard } from '@/lib/couple/cards';

export function SwipeDeck({
  cards,
  onSwipe,
  onAdClick,
  onToggleWishlist,
  emptyHint,
  topCardSavedToWishlist = false,
}: {
  cards: DeckCard[];
  onSwipe: (direction: 'left' | 'right', card: DeckCard) => void;
  onAdClick?: (card: DeckCard) => void;
  onToggleWishlist?: (card: DeckCard) => void;
  emptyHint?: string;
  topCardSavedToWishlist?: boolean;
}) {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const handleDragStart = (e: React.PointerEvent) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleDragMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const offset = {
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    };
    dragOffsetRef.current = offset;
    setDragOffset(offset);
  };

  const handleDragEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    const dx = dragOffsetRef.current.x;
    dragOffsetRef.current = { x: 0, y: 0 };
    setDragOffset({ x: 0, y: 0 });

    if (Math.abs(dx) > 80) {
      const card = cards[0];
      if (card) onSwipe(dx > 0 ? 'right' : 'left', card);
    }
  };

  const handleActionSwipe = (direction: 'left' | 'right') => {
    const card = cards[0];
    if (!card || isDragging) return;
    setDragOffset({ x: direction === 'right' ? window.innerWidth : -window.innerWidth, y: 0 });
    setTimeout(() => {
      onSwipe(direction, card);
      setDragOffset({ x: 0, y: 0 });
    }, 280);
  };

  const handleCardTap = () => {
    const card = cards[0];
    if (!card) return;
    if (card.__kind === 'ad') {
      // Tap ad = open URL
      const ad = card as any;
      if (ad.clickUrl) {
        try {
          window.open(ad.clickUrl, '_blank', 'noopener,noreferrer');
        } catch {}
      }
      onAdClick?.(card);
    }
  };

  if (cards.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center text-gray-400">
          <p className="text-lg font-bold mb-2">📭 沒有卡片了</p>
          {emptyHint && <p className="text-sm opacity-70">{emptyHint}</p>}
        </div>
      </div>
    );
  }

  const topCard = cards[0];
  const nextCard = cards[1];

  return (
    <div className="flex-1 flex flex-col">
      <div
        // Hermes 2026-08-14: flex-1 + flex + justify/align center so the
        // card is centered both ways. pt-12 clears the absolute-positioned
        // status pill + exit button at the top so the card's top border
        // isn't cut off. The next-card preview is absolute, sitting behind
        // the active card. Both cards inherit their width from the w-[88%]
        // wrapper below.
        className="flex-1 relative w-full flex flex-col justify-center items-center py-3 pt-12"
        onClick={handleCardTap}
      >
        {nextCard && (
          // Hermes 2026-08-14: next-card preview uses the same wrapper
          // (w-[88%] max-w-sm) as the active card so the dimensions match.
          // absolute positioned so it sits behind the active card.
          <div
            className="absolute top-1/2 left-1/2 w-[88%] max-w-sm"
            style={{ transform: 'translate(-50%, -50%) scale(0.95) translateY(15px)', opacity: 0.6, zIndex: 1, pointerEvents: 'none' }}
          >
            <div className="w-full h-[60vh] max-h-[600px] rounded-3xl bg-gray-800 shadow-sm overflow-hidden border-4 border-pink-500/50">
              <div
                className="w-full h-full bg-cover bg-center"
                style={{
                  backgroundImage: `url(${(nextCard as any).image})`,
                }}
              />
            </div>
          </div>
        )}

        {/* Hermes 2026-08-14: w-[88%] max-w-sm wrapper around SpotCard.
            SpotCard itself is relative w-full — it inherits width from here. */}
        <div className="w-[88%] max-w-sm">
          <SpotCard
            card={topCard}
            dragOffset={dragOffset}
            isDragging={isDragging}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            zIndex={10}
            onToggleWishlist={onToggleWishlist}
            savedToWishlist={topCardSavedToWishlist}
          />
        </div>
      </div>

      <div className="shrink-0 w-full flex justify-center space-x-12 px-6 pb-6 pt-2">
        <button
          onClick={() => handleActionSwipe('left')}
          disabled={cards.length === 0 || isDragging}
          className="w-16 h-16 rounded-full border-2 border-red-500/30 flex items-center justify-center text-red-500 hover:bg-red-500/20 bg-gray-900 transition disabled:opacity-30 cursor-pointer"
        >
          {topCard?.__kind === 'ad' ? <Ban size={28} strokeWidth={3} /> : <X size={32} strokeWidth={3} />}
        </button>
        <button
          onClick={() => handleActionSwipe('right')}
          disabled={cards.length === 0 || isDragging}
          className="w-16 h-16 rounded-full border-2 border-pink-500/50 flex items-center justify-center text-pink-500 hover:bg-pink-500/20 bg-gray-900 transition disabled:opacity-30 cursor-pointer"
        >
          {topCard?.__kind === 'ad' ? <Rocket size={28} strokeWidth={3} /> : <Heart size={32} strokeWidth={3} className="fill-current" />}
        </button>
      </div>
    </div>
  );
}
