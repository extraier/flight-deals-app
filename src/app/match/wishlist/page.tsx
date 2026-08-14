'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import {
  subscribeWishlist,
  removeFromWishlist,
  type WishlistEntry,
} from '@/lib/couple/wishlist';
import type { SpotCard } from '@/lib/couple/cards';
import {
  Heart,
  ArrowLeft,
  Trash2,
  MapPin,
  Calendar,
  Users,
  Plane,
  LogIn,
} from 'lucide-react';
import type { User } from 'firebase/auth';

export default function WishlistPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [entries, setEntries] = useState<WishlistEntry[]>([]);
  const [wishlistLoading, setWishlistLoading] = useState(true);
  const [allSpots, setAllSpots] = useState<Record<string, SpotCard>>({});
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  // Fetch all spots once (to look up spot data by spotId)
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'coupleSpots'));
        const map: Record<string, SpotCard> = {};
        snap.forEach((d) => {
          const data = d.data() as any;
          map[d.id] = { id: d.id, kind: 'spot', ...data } as SpotCard;
        });
        setAllSpots(map);
      } catch (err: any) {
        console.warn('Failed to load spots:', err);
      }
    })();
  }, []);

  // Wishlist subscription (only when signed in)
  useEffect(() => {
    if (!user || user.isAnonymous) {
      setEntries([]);
      setWishlistLoading(false);
      return;
    }
    setWishlistLoading(true);
    const unsub = subscribeWishlist(
      user.uid,
      (e) => {
        setEntries(e);
        setWishlistLoading(false);
      },
      (err) => {
        console.error('Wishlist subscription error:', err);
        setWishlistLoading(false);
      }
    );
    return unsub;
  }, [user]);

  const handleRemove = async (spotId: string) => {
    if (!user) return;
    setRemovingId(spotId);
    try {
      await removeFromWishlist(user.uid, spotId);
    } catch (err: any) {
      console.error('Remove failed:', err);
      alert('移除失敗: ' + (err.message || String(err)));
    } finally {
      setRemovingId(null);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 via-rose-50 to-pink-100">
        <div className="text-gray-400 text-sm">驗證中...</div>
      </div>
    );
  }

  if (!user || user.isAnonymous) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-rose-50 to-pink-100 dark:from-gray-950 dark:via-pink-950/30 dark:to-gray-950 px-4 py-8">
        <div className="mx-auto max-w-md">
          <Link href="/match" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft size={16} /> 返回配對頁
          </Link>
          <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-xl border border-pink-100 text-center">
            <div className="inline-flex w-16 h-16 rounded-full bg-pink-100 dark:bg-pink-900/30 items-center justify-center mb-3">
              <Heart size={28} className="text-pink-500" />
            </div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-2">💖 心願清單</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">
              登入後就可以保存想去嘅地方<br />
              手機電腦都睇到，唔會因為房間結束就消失
            </p>
            <Link
              href="/match/account"
              className="block w-full bg-gradient-to-r from-pink-500 to-rose-500 text-white font-bold py-3 rounded-2xl shadow-lg hover:scale-[1.02] transition flex items-center justify-center gap-2"
            >
              <LogIn size={18} /> 登入 / 註冊
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-rose-50 to-pink-100 dark:from-gray-950 dark:via-pink-950/30 dark:to-gray-950 px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <Link href="/match" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft size={16} /> 返回配對頁
        </Link>

        <div className="mb-6">
          <h1 className="text-3xl font-black text-gray-900 dark:text-white flex items-center gap-2">
            <Heart size={28} className="text-pink-500 fill-current" /> 心願清單
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {entries.length > 0 ? `${entries.length} 個目的地` : '尚未加入任何目的地'}
          </p>
        </div>

        {wishlistLoading ? (
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 text-center text-gray-400">
            載入中...
          </div>
        ) : entries.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 text-center border border-pink-100">
            <Heart size={48} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              去 <Link href="/match" className="text-pink-600 underline font-bold">配對頁</Link> 揀你心水嘅地方<br />
              Like 一張卡會自動加入呢度
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {entries.map((entry) => {
              const spot = allSpots[entry.spotId];
              return (
                <WishlistCard
                  key={entry.id}
                  entry={entry}
                  spot={spot}
                  onRemove={handleRemove}
                  removing={removingId === entry.spotId}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function WishlistCard({
  entry,
  spot,
  onRemove,
  removing,
}: {
  entry: WishlistEntry;
  spot?: SpotCard;
  onRemove: (spotId: string) => void;
  removing: boolean;
}) {
  const monthName = entry.targetMonth
    ? ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'][entry.targetMonth - 1]
    : null;
  const travelLabel = entry.travelWith === 'solo' ? '獨遊'
    : entry.travelWith === 'couple' ? '情侶'
    : entry.travelWith === 'family' ? '家庭'
    : entry.travelWith === 'friends' ? '朋友'
    : null;

  // If spot data hasn't loaded yet, show a skeleton card.
  if (!spot) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-pink-100 animate-pulse">
        <div className="h-32 bg-gray-100 dark:bg-gray-800 rounded-xl mb-3" />
        <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-3/4 mb-2" />
        <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-pink-100 dark:border-pink-900/30 group">
      <div
        className="h-36 bg-cover bg-center relative"
        style={{ backgroundImage: `url(${spot.image})` }}
      >
        {spot.dealCode && (
          <Link
            href={`/route/${spot.dealCode}`}
            className="absolute bottom-2 right-2 bg-white/90 text-pink-600 px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 hover:bg-white shadow"
          >
            <Plane size={12} /> 查機票
          </Link>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-bold text-gray-900 dark:text-white text-lg leading-tight truncate">
          {spot.name}
        </h3>
        {spot.nameEn && (
          <p className="text-xs text-gray-500 truncate">{spot.nameEn}</p>
        )}
        <div className="flex items-center gap-1 mt-1 text-xs text-gray-600 dark:text-gray-400">
          <MapPin size={12} /> {spot.city} · {spot.country}
        </div>

        {(monthName || travelLabel || entry.note) && (
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 space-y-1">
            {monthName && (
              <div className="flex items-center gap-1 text-xs text-gray-600">
                <Calendar size={12} /> 想去 {monthName}{entry.targetYear ? ` ${entry.targetYear}` : ''}
              </div>
            )}
            {travelLabel && (
              <div className="flex items-center gap-1 text-xs text-gray-600">
                <Users size={12} /> {travelLabel}
              </div>
            )}
            {entry.note && (
              <p className="text-xs text-gray-500 italic mt-1">「{entry.note}」</p>
            )}
          </div>
        )}

        <button
          onClick={() => onRemove(spot.id)}
          disabled={removing}
          className="mt-3 w-full text-xs text-gray-400 hover:text-red-500 flex items-center justify-center gap-1 disabled:opacity-50"
          aria-label={`從心願清單移除 ${spot.name}`}
        >
          <Trash2 size={12} /> {removing ? '移除中...' : '移除'}
        </button>
      </div>
    </div>
  );
}
