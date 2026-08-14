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
        className="flex-1 relative w-full flex justify-center items-center py-2"
        onClick={handleCardTap}
      >
        {nextCard && (
          // Hermes 2026-08-14: matched aspect-[3/4] + max-h-[95%] to match
          // the active card so the preview peeks correctly.
          <div
            className="absolute w-[92%] rounded-3xl bg-gray-800 shadow-sm overflow-hidden border-2 border-pink-900/30 select-none aspect-[3/4] max-h-[95%]"
            style={{ transform: 'scale(0.95) translateY(15px)', opacity: 0.6, zIndex: 1 }}
          >
            <div
              className="w-full h-full bg-cover bg-center"
              style={{
                backgroundImage: `url(${(nextCard as any).image})`,
              }}
            />
          </div>
        )}

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
