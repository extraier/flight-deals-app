'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Lock, BarChart3, Image as ImageIcon, Plus, ToggleLeft, ToggleRight, ExternalLink } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';

type Spot = {
  id: string;
  name: string;
  city: string;
  country: string;
  region: string;
  image: string;
  blurb: string;
  tags: string[];
  priceLevel: number;
  dealCode?: string;
};

type Ad = {
  id: string;
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

/**
 * Server-side admin mutations. The browser never gets to write Firestore
 * directly for `coupleAds`/`coupleSpots` — the route handler validates the
 * HMAC-signed session cookie, then writes via the service-account access
 * token (which bypasses Firestore rules).
 */
async function adminMutate(
  collection: 'coupleAds' | 'coupleSpots',
  id: string,
  fields: Record<string, unknown>
): Promise<void> {
  const res = await fetch('/match/api/admin-mutate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ collection, id, fields }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null); // null = loading
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [tab, setTab] = useState<'spots' | 'ads'>('ads');

  // Verify session on mount by asking the server (cookie is httpOnly so
  // document.cookie can't see it). F-05 fix: server-side check replaces
  // the broken client-side cookie scan.
  useEffect(() => {
    fetch('/match/api/admin-auth', { credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) setAuthed(true);
        else setAuthed(false);
      })
      .catch(() => setAuthed(false));
  }, []);

  // Load data when authed
  useEffect(() => {
    if (!authed) return;
    Promise.all([
      getDocs(collection(db, 'coupleSpots')).then((snap) => {
        setSpots(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      }),
      getDocs(collection(db, 'coupleAds')).then((snap) => {
        setAds(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      }),
    ]).catch((err) => setError('失敗: ' + err.message));
  }, [authed]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/match/api/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.ok) {
        setAuthed(true);
      } else {
        setError(data.error || '登入失敗');
      }
    } catch (err: any) {
      setError('登入失敗: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleAdActive = async (ad: Ad) => {
    try {
      await adminMutate('coupleAds', ad.id, { active: !ad.active });
      setAds((prev) => prev.map((a) => (a.id === ad.id ? { ...a, active: !a.active } : a)));
    } catch (err: any) {
      setError('切換失敗: ' + err.message);
    }
  };

  const resetAdCounters = async (ad: Ad) => {
    try {
      await adminMutate('coupleAds', ad.id, { impressions: 0, clicks: 0 });
      setAds((prev) =>
        prev.map((a) => (a.id === ad.id ? { ...a, impressions: 0, clicks: 0 } : a))
      );
    } catch (err: any) {
      setError('重置失敗: ' + err.message);
    }
  };

  // Loading state until session check resolves
  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-gray-400 text-sm">驗證中...</div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-950 flex items-center justify-center px-6">
        <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-3xl p-8 shadow-2xl">
          <Link
            href="/match"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
          >
            <ArrowLeft size={16} />
            返回配對頁
          </Link>
          <div className="text-center mb-6">
            <div className="inline-flex w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 items-center justify-center mb-4">
              <Lock size={28} className="text-slate-600 dark:text-slate-300" />
            </div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white">管理員登入</h1>
            <p className="text-sm text-gray-500 mt-2">情侶配對後台</p>
          </div>
          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密碼"
              className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-xl font-bold outline-none focus:ring-2 ring-pink-400"
            />
            {error && (
              <div className="mt-3 text-red-600 text-sm font-medium">{error}</div>
            )}
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full mt-4 bg-gradient-to-r from-pink-500 to-rose-500 text-white font-bold py-3 rounded-xl transition disabled:opacity-50"
            >
              {loading ? '登入中...' : '登入'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/match"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft size={16} />
          返回配對頁
        </Link>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-black text-gray-900 dark:text-white flex items-center gap-3">
            <BarChart3 size={28} className="text-pink-500" />
            配對後台
          </h1>
          <div className="flex gap-2 bg-white dark:bg-gray-900 rounded-xl p-1 border border-gray-200 dark:border-gray-800">
            <button
              onClick={() => setTab('ads')}
              className={`px-4 py-2 rounded-lg font-bold text-sm transition ${tab === 'ads' ? 'bg-pink-500 text-white' : 'text-gray-500'}`}
            >
              廣告 ({ads.length})
            </button>
            <button
              onClick={() => setTab('spots')}
              className={`px-4 py-2 rounded-lg font-bold text-sm transition ${tab === 'spots' ? 'bg-pink-500 text-white' : 'text-gray-500'}`}
            >
              景點 ({spots.length})
            </button>
          </div>
        </div>

        {tab === 'ads' && (
          <div className="space-y-3">
            {ads.length === 0 && <p className="text-gray-500 text-sm">無廣告</p>}
            {ads.map((ad) => (
              <div
                key={ad.id}
                className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm border border-gray-200 dark:border-gray-800"
              >
                <div className="flex gap-4">
                  <div
                    className="w-24 h-24 rounded-xl bg-cover bg-center shrink-0"
                    style={{ backgroundImage: `url(${ad.image})` }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-pink-600 uppercase">{ad.sponsor}</span>
                        <h3 className="font-bold text-gray-900 dark:text-white truncate">{ad.title}</h3>
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{ad.body}</p>
                      </div>
                      <button
                        onClick={() => toggleAdActive(ad)}
                        className={`shrink-0 p-2 rounded-lg ${ad.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}
                      >
                        {ad.active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                      </button>
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <div className="flex gap-4 text-xs">
                        <span className="text-gray-500">
                          曝光: <strong className="text-gray-900 dark:text-white">{ad.impressions || 0}</strong>
                        </span>
                        <span className="text-gray-500">
                          點擊: <strong className="text-gray-900 dark:text-white">{ad.clicks || 0}</strong>
                        </span>
                        <span className="text-gray-500">
                          CTR: <strong className="text-gray-900 dark:text-white">
                            {ad.impressions ? ((ad.clicks / ad.impressions) * 100).toFixed(1) : 0}%
                          </strong>
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <a
                          href={ad.clickUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-gray-400 hover:text-pink-500"
                        >
                          <ExternalLink size={14} />
                        </a>
                        <button
                          onClick={() => resetAdCounters(ad)}
                          className="text-xs text-gray-400 hover:text-red-500 px-2 py-1"
                        >
                          重置
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'spots' && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {spots.map((spot) => (
              <div
                key={spot.id}
                className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-200 dark:border-gray-800"
              >
                <div
                  className="w-full h-32 bg-cover bg-center"
                  style={{ backgroundImage: `url(${spot.image})` }}
                />
                <div className="p-3">
                  <h3 className="font-bold text-sm text-gray-900 dark:text-white truncate">{spot.name}</h3>
                  <p className="text-xs text-gray-500 mt-1">{spot.city} · {spot.country}</p>
                  <span className="text-[10px] uppercase font-bold text-pink-600 mt-1 inline-block">
                    {spot.region}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-xl text-xs text-yellow-800 dark:text-yellow-200">
          💡 新增景點或廣告：編輯 <code className="bg-yellow-100 dark:bg-yellow-900/50 px-1.5 py-0.5 rounded">src/data/couple/spots.json</code> 或 <code className="bg-yellow-100 dark:bg-yellow-900/50 px-1.5 py-0.5 rounded">ads.json</code>，執行 <code className="bg-yellow-100 dark:bg-yellow-900/50 px-1.5 py-0.5 rounded">node /Users/roger/scripts/seed-firestore-couple.mjs</code> 同步到 Firestore，push 即可部署。
        </div>
      </div>
    </div>
  );
}
