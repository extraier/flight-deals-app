'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Heart, Copy, Users, ArrowLeft, Shuffle } from 'lucide-react';
import { ensureAnonAuth } from '@/lib/firebase/client';
import { createRoom, joinRoom } from '@/lib/couple/room';

export default function CouplePage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    ensureAnonAuth()
      .then(setUid)
      .catch((err) => setError('初始化失敗: ' + err.message));
  }, []);

  const handleCreate = async () => {
    if (!uid) return;
    setLoading(true);
    setError('');
    try {
      const roomId = await createRoom(uid);
      router.push(`/match/room/${roomId}`);
    } catch (err: any) {
      setError('建立房間失敗: ' + err.message);
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!uid) return;
    if (joinCode.length !== 8) {
      setError('房間號碼為 8 位');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const code = joinCode.toUpperCase();
      const room = await joinRoom(uid, code);
      router.push(`/match/room/${code}`);
    } catch (err: any) {
      setError(err.message || '加入房間失敗');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-rose-50 to-pink-100 dark:from-gray-950 dark:via-pink-950/30 dark:to-gray-950">
      <div className="mx-auto max-w-md px-4 py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft size={16} />
          返回主頁
        </Link>

        <div className="text-center mb-8">
          <div className="inline-flex w-20 h-20 rounded-full bg-pink-100 dark:bg-pink-900/30 items-center justify-center mb-4">
            <Heart size={40} className="text-pink-500 fill-current" />
          </div>
          <h1 className="text-3xl font-black text-gray-900 dark:text-white mb-2">
            🗺 一起揀目的地
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            兩個人一起 Swipe 想去嘅地方 ·
            <br />
            兩個都 Like 就會配對成功！情侶、朋友、同事都啱用
          </p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-xl border border-pink-100 dark:border-pink-900/30">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">開始配對</h2>

          <button
            onClick={handleCreate}
            disabled={loading || !uid}
            className="w-full bg-gradient-to-r from-pink-500 to-rose-500 text-white font-bold py-4 rounded-2xl shadow-lg hover:scale-[1.02] transition disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
          >
            <Users size={20} />
            {loading ? '建立中...' : '建立專屬房間'}
          </button>

          <div className="relative py-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200 dark:border-gray-800" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 bg-white dark:bg-gray-900 text-gray-400 text-xs font-bold uppercase">
                OR
              </span>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-gray-800 p-2 rounded-2xl border border-gray-200 dark:border-gray-700 flex shadow-sm focus-within:ring-2 ring-pink-400 transition">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="輸入 8 位房間號碼"
              maxLength={8}
              className="flex-1 bg-transparent px-4 font-bold text-gray-700 dark:text-gray-200 placeholder-gray-400 tracking-widest outline-none uppercase"
            />
            <button
              onClick={handleJoin}
              disabled={loading || !uid || joinCode.length !== 8}
              className="bg-gray-900 dark:bg-white text-white dark:text-gray-900 px-6 py-3 rounded-xl font-bold transition hover:bg-black dark:hover:bg-gray-100 disabled:opacity-30"
            >
              加入房間
            </button>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm font-medium">
              {error}
            </div>
          )}
        </div>

        <div className="text-center text-xs text-gray-400 mt-6">
          配對成功後可查看相關機票優惠
        </div>
      </div>
    </div>
  );
}
