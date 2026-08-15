'use client';

import { use, useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Heart, LogOut, Copy, Users, Sparkles, Moon, Sun } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, ensureAnonAuth } from '@/lib/firebase/client';
import { subscribeRoom, swipe, fetchSpots, fetchAds, type RoomData } from '@/lib/couple/room';
import { buildDeck, filterUnswiped, intersection, type DeckCard, type SpotCard, type AdCard } from '@/lib/couple/cards';
import { SwipeDeck } from '@/components/couple/SwipeDeck';
import { MatchModal } from '@/components/couple/MatchModal';
import { recordAdMetric } from '@/lib/couple/ads';
import {
  subscribeWishlist,
  addToWishlist,
  removeFromWishlist,
  isInWishlist,
  type WishlistEntry,
} from '@/lib/couple/wishlist';
import type { User } from 'firebase/auth';
import { useTheme } from 'next-themes';

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  // Proxy lowercases URL paths (src/proxy.ts) so /match/room/eoog stays eoog.
  // Room IDs are stored uppercase in Firestore — uppercase before lookup.
  const { id: rawRoomId } = use(params);
  const roomId = rawRoomId.toUpperCase();
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomData | null>(null);
  const [spots, setSpots] = useState<SpotCard[]>([]);
  const [ads, setAds] = useState<AdCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [matchSpot, setMatchSpot] = useState<SpotCard | null>(null);
  const [seenAdIds, setSeenAdIds] = useState<Set<string>>(new Set());
  const impressionedAdIdsRef = useRef<Set<string>>(new Set());
  const matchCountRef = useRef(0);
  // Phase 2.6: track the signed-in user (not anon) + their wishlist for
  // the heart-fill state on SpotCard.
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [wishlistEntries, setWishlistEntries] = useState<WishlistEntry[]>([]);

  // Bootstrap: auth + fetch spots/ads
  useEffect(() => {
    Promise.all([ensureAnonAuth(), fetchSpots(), fetchAds()])
      .then(([userId, fetchedSpots, fetchedAds]) => {
        setUid(userId);
        setSpots(fetchedSpots);
        setAds(fetchedAds);
      })
      .catch((err) => setError('初始化失敗: ' + err.message));
  }, []);

  // Phase 2.6: track the signed-in user separately from the anon uid.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAuthUser(u));
    return unsub;
  }, []);

  // Phase 2.6: subscribe to the user's wishlist when signed in (non-anon).
  // We set state inside the effect to clear the list when the user
  // transitions to anon/null — alternative would be to derive from a
  // separate "subscribedEntries" state guarded by a render check, but
  // that doubles the bookkeeping without simplifying the code path.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!authUser || authUser.isAnonymous) {
      setWishlistEntries([]);
      return;
    }
    const unsub = subscribeWishlist(
      authUser.uid,
      setWishlistEntries,
      (err) => console.warn('Wishlist subscription error:', err)
    );
    return unsub;
  }, [authUser]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Subscribe to room
  useEffect(() => {
    if (!uid) return;
    const unsub = subscribeRoom(roomId, (r) => {
      setRoom(r);
      setLoading(false);
      if (!r) {
        setError('房間不存在或已關閉');
      }
    });
    return unsub;
  }, [uid, roomId]);

  // Detect new matches. The matchCountRef tracks the previously-seen
  // count so we only fire the match modal when a NEW mutual like
  // appears. This is a "compare against previous value" pattern that
  // requires an effect — the alternative (a derived useMemo that diffs
  // the mutual array) would still need an effect to surface the
  // modal at the right time, so we'd be moving the setState around
  // without removing it.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!room || !uid) return;
    const myLikes = room.user1 === uid ? room.user1Likes : room.user2Likes;
    const partnerLikes = room.user1 === uid ? room.user2Likes : room.user1Likes;
    const mutual = intersection(myLikes, partnerLikes);

    if (mutual.length > matchCountRef.current) {
      const latestMatchId = mutual[mutual.length - 1];
      const matchCard = spots.find((s) => s.id === latestMatchId);
      if (matchCard) {
        setMatchSpot(matchCard);
      }
      matchCountRef.current = mutual.length;
    }
  }, [room, uid, spots]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Build the deck
  const deck = useMemo(() => {
    if (!room || spots.length === 0) return [];
    const myLikes = room.user1 === uid ? room.user1Likes || [] : room.user2Likes || [];
    const myDislikes = room.user1 === uid ? room.user1Dislikes || [] : room.user2Dislikes || [];

    const fullDeck = buildDeck(spots, ads, room.deckSeed, seenAdIds);
    return filterUnswiped(fullDeck, myLikes, myDislikes);
  }, [room, spots, ads, uid, seenAdIds]);

  // F-11: Fire ONE impression when an ad becomes the top card.
  useEffect(() => {
    const top = deck[0];
    if (!top || top.__kind !== 'ad') return;
    if (impressionedAdIdsRef.current.has(top.id)) return;
    impressionedAdIdsRef.current.add(top.id);
    recordAdMetric(top.id, 'impressions');
  }, [deck]);

  const handleSwipe = async (direction: 'left' | 'right', card: DeckCard) => {
    if (!uid || !room) return;

    if (card.__kind === 'ad') {
      setSeenAdIds((prev) => new Set([...prev, card.id]));
    }

    if (
      direction === 'right' &&
      card.__kind === 'spot' &&
      authUser &&
      !authUser.isAnonymous
    ) {
      addToWishlist(authUser.uid, card.id).catch((err) =>
        console.warn('wishlist auto-save failed:', err)
      );
    }

    try {
      await swipe(roomId, uid, card.id, direction);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError('記錄失敗: ' + (e.message ?? String(err)));
    }
  };

  const handleAdClick = (card: DeckCard) => {
    recordAdMetric(card.id, 'clicks');
    if (uid && room) {
      swipe(roomId, uid, card.id, 'right').catch((err) =>
        console.warn('ad auto-swipe failed:', err),
      );
    }
  };

  const handleToggleWishlist = async (card: DeckCard) => {
    if (!authUser || authUser.isAnonymous || card.__kind !== 'spot') return;
    if (isInWishlist(wishlistEntries, card.id)) {
      await removeFromWishlist(authUser.uid, card.id).catch((err) =>
        console.warn('wishlist remove failed:', err),
      );
    } else {
      await addToWishlist(authUser.uid, card.id).catch((err) =>
        console.warn('wishlist add failed:', err),
      );
    }
  };

  const topCardSavedToWishlist =
    deck[0]?.__kind === 'spot' && isInWishlist(wishlistEntries, deck[0].id);

  const isUser1 = room?.user1 === uid;
  const isUser2 = room?.user2 === uid;
  const partnerJoined = room?.user1 && room?.user2;

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-gradient-to-br from-pink-50 to-rose-100">
        <div className="text-center">
          <p className="text-red-600 font-bold mb-4">{error}</p>
          <Link href="/" className="text-pink-600 underline">
            返回機票格價
          </Link>
        </div>
      </div>
    );
  }

  if (loading || !room) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 to-rose-100">
        <div className="text-center">
          <Users size={48} className="mx-auto text-pink-400 animate-pulse mb-4" />
          <p className="text-gray-600">載入房間...</p>
        </div>
      </div>
    );
  }

  // Waiting for partner
  if (!partnerJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-pink-50 p-6">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-sm text-center border border-pink-100 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-pink-400 to-rose-500" />
          <Users size={48} className="mx-auto text-pink-300 mb-4 animate-pulse" />
          <p className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2">房間號碼</p>
          <h1 className="text-5xl font-black text-gray-800 tracking-widest mb-6 font-mono bg-pink-50 py-3 rounded-xl border border-pink-100">
            {roomId}
          </h1>
          <button
            onClick={() => {
              navigator.clipboard.writeText(roomId);
            }}
            className="flex items-center justify-center w-full bg-pink-100 text-pink-600 font-bold py-3 rounded-xl mb-6 hover:bg-pink-200 transition"
          >
            <Copy size={16} className="mr-2" />
            複製號碼
          </button>
          <p className="text-sm font-bold text-pink-500 animate-pulse">等待另一半加入...</p>
        </div>
        <Link
          href="/"
          className="mt-8 text-gray-600 hover:text-gray-900 font-bold text-sm underline"
        >
          返回機票格價
        </Link>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col bg-gradient-to-br from-gray-900 via-pink-950/30 to-gray-900 relative"
      style={{ minHeight: '100svh' }}
    >
      <div className="absolute top-2 left-2 z-30 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-gray-700 flex items-center">
        <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse" />
        <span className="text-white text-xs font-bold">配對成功 · 開始 Swipe</span>
      </div>
      {/* Hermes 2026-08-14 (screenshot 9): top-right buttons (wishlist, theme, exit).
          The wishlist link saves roomId to sessionStorage so MatchNav's back
          button on the wishlist page renders "返回情侶房間" + href=/match/room/{id}.

          Hermes 2026-08-14 (screenshot 11): the exit button (↗) goes to /
          (flight deals landing page) — not /match. The room page is the
          OUTER page in the couple flow, so "leaving" means going back to
          where the user came from, which is the flight deals page (機票格價). */}
      <div className="absolute top-2 right-2 z-30 flex items-center gap-2">
        <RoomWishlistLink roomId={roomId} />
        <RoomThemeToggle />
        <Link
          href="/"
          aria-label="返回機票格價"
          className="p-2 bg-black/50 text-white rounded-full hover:bg-red-500 transition"
        >
          <LogOut size={16} />
        </Link>
      </div>

      <SwipeDeck
        cards={deck}
        onSwipe={handleSwipe}
        onAdClick={handleAdClick}
        onToggleWishlist={
          authUser && !authUser.isAnonymous ? handleToggleWishlist : undefined
        }
        topCardSavedToWishlist={topCardSavedToWishlist}
        emptyHint={`所有卡片都 Swipe 完！${spotMatchCount(room, isUser1 ? 'user1' : 'user2')} 個配對。`}
      />

      {matchSpot && (
        <MatchModal
          match={matchSpot}
          onClose={() => setMatchSpot(null)}
          onNext={() => setMatchSpot(null)}
          roomId={roomId}
        />
      )}
    </div>
  );
}

function spotMatchCount(room: RoomData, side: 'user1' | 'user2'): number {
  const myLikes = side === 'user1' ? room.user1Likes : room.user2Likes;
  const partnerLikes = side === 'user1' ? room.user2Likes : room.user1Likes;
  return intersection(myLikes, partnerLikes).length;
}

// Hermes 2026-08-14 (screenshot 9): inline wishlist link for the room page.
// Saves the current room ID to sessionStorage on click so MatchNav (the
// wishlist page's nav) can render a "back to room" button instead of the
// generic "返回一起揀目的地". The sessionStorage key is intentionally scoped
// to this single use case so other nav refreshes don't pick it up.
function RoomWishlistLink({ roomId }: { roomId: string }) {
  return (
    <Link
      href="/match/wishlist"
      aria-label="查看心願清單"
      onClick={() => {
        try {
          sessionStorage.setItem(
            'matchWishlistBack',
            JSON.stringify({ href: `/match/room/${roomId}`, label: '返回情侶房間' })
          );
          // Hermes 2026-08-14: dispatch a custom event so any mounted
          // MatchNav on this same tab re-reads sessionStorage via its
          // useSyncExternalStore subscription. (The browser's 'storage'
          // event fires across tabs but NOT on the same tab that wrote.)
          window.dispatchEvent(new Event('matchWishlistBackChange'));
        } catch {
          // sessionStorage might be disabled (privacy mode etc.) — fall
          // back to /match which is the MatchNav default.
        }
      }}
      className="p-2 bg-black/50 text-white rounded-full hover:bg-pink-500 transition"
    >
      <Heart size={16} />
    </Link>
  );
}

function RoomThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Hermes 2026-08-14: standard next-themes hydration pattern (same as
  // the global ThemeToggle — see that component for full rationale).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => setMounted(true), []);
  /* eslint-enable react-hooks/set-state-in-effect */
  if (!mounted) return null;
  return (
    <button
      type="button"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={theme === 'dark' ? '切換到淺色主題' : '切換到深色主題'}
      className="p-2 bg-black/50 text-white rounded-full hover:bg-pink-500 transition"
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
