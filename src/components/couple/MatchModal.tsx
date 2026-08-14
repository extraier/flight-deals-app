'use client';

import { Heart, X, Plane } from 'lucide-react';
import Link from 'next/link';
import type { SpotCard as SpotCardType } from '@/lib/couple/cards';

interface MatchModalProps {
  match: SpotCardType;
  onClose: () => void;
  onNext: () => void;
  roomId?: string;  // Hermes 2026-08-14: passed so the 查看機票 back-button
                    // returns to THIS room instead of the airport selector.
}

export function MatchModal({ match, onClose, onNext, roomId }: MatchModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-pink-950/40 backdrop-blur-md p-4 animate-in fade-in duration-300">
      <div className="bg-gradient-to-br from-pink-500 via-rose-500 to-pink-600 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl relative text-center">
        <div className="absolute -top-10 -right-10 opacity-20">
          <Heart size={120} className="text-white fill-current" />
        </div>
        <div className="absolute -bottom-10 -left-10 opacity-20">
          <Heart size={120} className="text-white fill-current" />
        </div>

        <div className="p-8 text-white relative">
          <div className="flex justify-center mb-4">
            <div className="bg-white/20 backdrop-blur-md rounded-full p-4 border-2 border-white/40">
              <Heart size={48} className="fill-current animate-bounce" />
            </div>
          </div>
          <h2 className="text-4xl font-black italic tracking-wider mb-2 drop-shadow-lg">配對成功！</h2>
          <p className="text-base font-medium opacity-90 mb-6">你們都想去呢個地方 🎉</p>

          <div className="bg-white/95 rounded-2xl overflow-hidden shadow-xl mb-4">
            <div
              className="w-full h-40 bg-cover bg-center"
              style={{ backgroundImage: `url(${match.image})` }}
            />
            <div className="p-4 text-gray-800">
              <h3 className="text-xl font-black mb-1">{match.name}</h3>
              <p className="text-xs text-gray-500 mb-2">
                {match.country} · {match.city}
              </p>
              <p className="text-sm text-gray-700 leading-relaxed">{match.blurb}</p>
            </div>
          </div>

          {match.dealCode && (
            // Hermes 2026-08-14: pass ?from=room:<roomId> so the route page's
            // back button returns to this couple room.
            <Link
              href={`/route/${match.dealCode}${roomId ? `?from=room:${roomId}` : ''}`}
              className="flex items-center justify-center gap-2 w-full bg-white text-pink-600 font-bold py-3 rounded-2xl mb-2 hover:bg-pink-50 transition shadow-lg"
            >
              <Plane size={18} />
              查看機票
            </Link>
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 bg-white/20 backdrop-blur-md text-white font-bold py-3 rounded-2xl hover:bg-white/30 transition"
            >
              <X size={18} className="inline mr-1" />
              關閉
            </button>
            <button
              onClick={onNext}
              className="flex-1 bg-white text-pink-600 font-bold py-3 rounded-2xl hover:bg-pink-50 transition shadow-lg"
            >
              繼續
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
