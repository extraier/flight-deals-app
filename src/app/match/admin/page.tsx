'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Lock, BarChart3, Plus, ToggleLeft, ToggleRight, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { MatchNav } from '@/components/couple/MatchNav';
import { SpotEditModal, type SpotRow } from './SpotEditModal';
import { AdEditModal, type AdRow } from './AdEditModal';
import type { AdminMutate } from './types';
import { normalizedAdMetrics } from '@/lib/couple/adminMetrics';
import {
  safeAdminAdBackgroundImage,
  safeAdminAdPreviewUrl,
} from '@/lib/couple/adminAdUrls';

type Ad = AdRow;

/**
 * Server-side admin mutations. The browser never gets to write Firestore
 * directly for `coupleAds`/`coupleSpots` — the route handler validates the
 * HMAC-signed session cookie, then writes via the service-account access
 * token (which bypasses Firestore rules).
 *
 * `options.delete: true` triggers a Firestore DELETE on the document.
 */
async function adminMutate(
  ...args: Parameters<AdminMutate>
): ReturnType<AdminMutate> {
  const [collection, id, fields, options] = args;
  const res = await fetch('/match/api/admin-mutate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ collection, id, fields, ...(options?.delete ? { delete: true } : {}) }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm border border-gray-200 dark:border-gray-800">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-black text-gray-900 dark:text-white">{value}</div>
    </div>
  );
}

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [spots, setSpots] = useState<SpotRow[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [tab, setTab] = useState<'spots' | 'ads'>('ads');

  // Hermes 2026-08-14 (Phase 3.4): search/filter for the spot list now that
  // there are 646 spots. Filters by name/city/country/region, plus a
  // "no image" pill that surfaces the spots needing image backfill.
  const [spotQuery, setSpotQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [missingImageOnly, setMissingImageOnly] = useState(false);

  // Edit modal state — exactly one modal open at a time
  const [editingSpot, setEditingSpot] = useState<SpotRow | null>(null);
  const [spotIsNew, setSpotIsNew] = useState(false);
  const [editingAd, setEditingAd] = useState<Ad | null>(null);
  const [adIsNew, setAdIsNew] = useState(false);

  useEffect(() => {
    fetch('/match/api/admin-auth', { credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) setAuthed(true);
        else setAuthed(false);
      })
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    if (!authed) return;
    Promise.all([
      getDocs(collection(db, 'coupleSpots')).then((snap) => {
        setSpots(
          snap.docs.map((d) => {
            const data = d.data() as Omit<SpotRow, 'id'>;
            return { ...data, id: d.id };
          })
        );
      }),
      getDocs(collection(db, 'coupleAds')).then((snap) => {
        setAds(
          snap.docs.map((d) => {
            const data = d.data() as Omit<AdRow, 'id'>;
            return { ...data, id: d.id };
          })
        );
      }),
    ]).catch((err: unknown) => {
      const e = err as { message?: string };
      setError('失敗: ' + (e.message ?? String(err)));
    });
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
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError('登入失敗: ' + (e.message ?? String(err)));
    } finally {
      setLoading(false);
    }
  };

  const toggleAdActive = async (ad: Ad) => {
    try {
      await adminMutate('coupleAds', ad.id, { active: !ad.active });
      setAds((prev) => prev.map((a) => (a.id === ad.id ? { ...a, active: !a.active } : a)));
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError('切換失敗: ' + (e.message ?? String(err)));
    }
  };

  const resetAdCounters = async (ad: Ad) => {
    try {
      await adminMutate('coupleAds', ad.id, { impressions: 0, clicks: 0 });
      setAds((prev) =>
        prev.map((a) => (a.id === ad.id ? { ...a, impressions: 0, clicks: 0 } : a))
      );
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError('重置失敗: ' + (e.message ?? String(err)));
    }
  };

  // ── Spot CRUD wiring ──────────────────────────────────────────────
  const openNewSpot = () => {
    setSpotIsNew(true);
    setEditingSpot({
      id: '',
      name: '',
      nameEn: '',
      city: '',
      cityEn: '',
      country: '',
      countryCode: '',
      region: '東南亞',
      image: '',
      imageCredit: '',
      blurb: '',
      tags: [],
      travelMood: [],
      priceLevel: 1,
      dealCode: '',
    });
  };

  const openEditSpot = (spot: SpotRow) => {
    setSpotIsNew(false);
    setEditingSpot(spot);
  };

  const onSpotSaved = (saved: SpotRow) => {
    setSpots((prev) => {
      const idx = prev.findIndex((s) => s.id === saved.id);
      if (idx === -1) return [...prev, saved];
      return prev.map((s) => (s.id === saved.id ? saved : s));
    });
    setEditingSpot(null);
  };

  const onSpotDeleted = (id: string) => {
    setSpots((prev) => prev.filter((s) => s.id !== id));
  };

  // ── Ad CRUD wiring ────────────────────────────────────────────────
  const openNewAd = () => {
    setAdIsNew(true);
    setEditingAd({
      id: '',
      sponsor: '',
      title: '',
      image: '',
      body: '',
      ctaLabel: '了解更多',
      clickUrl: '',
      impressions: 0,
      clicks: 0,
      budget: undefined,
      active: true,
    });
  };

  const openEditAd = (ad: Ad) => {
    setAdIsNew(false);
    setEditingAd(ad);
  };

  const onAdSaved = (saved: Ad) => {
    setAds((prev) => {
      const idx = prev.findIndex((a) => a.id === saved.id);
      if (idx === -1) return [...prev, saved];
      return prev.map((a) => (a.id === saved.id ? saved : a));
    });
    setEditingAd(null);
  };

  // Loading state until session check resolves
  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        {/* Hermes 2026-08-14: text-gray-400 was invisible on gray-50. */}
        <div className="text-gray-500 text-sm">驗證中...</div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-950 flex items-center justify-center px-6">
        <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-3xl p-8 shadow-2xl">
          {/* Hermes 2026-08-14: MatchNav replaces inline arrow so admin matches
              the /match/wishlist/account nav pattern. */}
          <div className="mb-6 -mx-8 -mt-8 px-8 pt-8 pb-6 rounded-t-3xl">
            <MatchNav />
          </div>
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
        <MatchNav />

        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
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

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg flex items-start justify-between gap-2">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-700 hover:text-red-900">✕</button>
          </div>
        )}

        {tab === 'ads' && (
          <div className="space-y-4">
            {/* Aggregate stats row */}
            {ads.length > 0 && (() => {
              // Hermes 2026-08-22 (Manus Defect B): normalize every ad
              // before summing so a malformed record can't inject NaN
              // into the totals. The helper is the single source of
              // truth for safe CTR math.
              const totals = ads.reduce(
                (acc, ad) => {
                  const m = normalizedAdMetrics(ad);
                  acc.impressions += m.impressions;
                  acc.clicks += m.clicks;
                  return acc;
                },
                { impressions: 0, clicks: 0 }
              );
              const activeAds = ads.filter((a) => a.active).length;
              const overallCtr = totals.impressions > 0
                ? (totals.clicks / totals.impressions) * 100
                : 0;
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="總曝光" value={totals.impressions} />
                  <StatCard label="總點擊" value={totals.clicks} />
                  <StatCard label="整體 CTR" value={`${overallCtr.toFixed(2)}%`} />
                  <StatCard label="活躍廣告" value={`${activeAds} / ${ads.length}`} />
                </div>
              );
            })()}

            <button
              onClick={openNewAd}
              className="w-full bg-white dark:bg-gray-900 rounded-2xl p-3 border-2 border-dashed border-gray-300 dark:border-gray-700 text-gray-500 hover:text-pink-600 hover:border-pink-400 transition flex items-center justify-center gap-2 text-sm font-bold"
            >
              <Plus size={16} /> 新增廣告
            </button>

            {[...ads]
              .sort((a, b) => {
                if (a.active !== b.active) return a.active ? -1 : 1;
                // Hermes 2026-08-22 (Manus Defect B): use the shared
                // helper so a malformed ad (NaN impressions, string
                // clicks) never poisons the sort comparator.
                const aCtr = normalizedAdMetrics(a).ctr;
                const bCtr = normalizedAdMetrics(b).ctr;
                return bCtr - aCtr;
              })
              .map((ad) => {
                const previewUrl = safeAdminAdPreviewUrl(ad.clickUrl);
                return (
              <div
                key={ad.id}
                className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm border border-gray-200 dark:border-gray-800"
              >
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => openEditAd(ad)}
                    className="w-24 h-24 rounded-xl bg-cover bg-center shrink-0 cursor-pointer hover:opacity-80 transition ring-0 hover:ring-2 hover:ring-pink-400"
                    style={{ backgroundImage: safeAdminAdBackgroundImage(ad.image) }}
                    aria-label={`編輯 ${ad.title}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openEditAd(ad)}
                        className="text-left min-w-0 flex-1"
                      >
                        <span className="text-xs font-bold text-pink-600 uppercase">{ad.sponsor}</span>
                        <h3 className="font-bold text-gray-900 dark:text-white truncate">{ad.title}</h3>
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{ad.body}</p>
                      </button>
                      <button
                        onClick={() => toggleAdActive(ad)}
                        className={`shrink-0 p-2 rounded-lg ${ad.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}
                        aria-label={ad.active ? '停用' : '啟用'}
                      >
                        {ad.active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                      </button>
                    </div>
                    <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
                      <div className="flex gap-3 text-xs">
                        <span className="text-gray-500">
                          曝光: <strong className="text-gray-900 dark:text-white">{normalizedAdMetrics(ad).impressions}</strong>
                        </span>
                        <span className="text-gray-500">
                          點擊: <strong className="text-gray-900 dark:text-white">{normalizedAdMetrics(ad).clicks}</strong>
                        </span>
                        <span className="text-gray-500">
                          CTR: <strong className="text-gray-900 dark:text-white">
                            {normalizedAdMetrics(ad).ctr.toFixed(1)}%
                          </strong>
                        </span>
                      </div>
                      <div className="flex gap-1">
                        {previewUrl ? (
                          <a
                            href={previewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-gray-400 hover:text-pink-500"
                            aria-label="開新分頁預覽"
                          >
                            <ExternalLink size={14} />
                          </a>
                        ) : (
                          <span
                            className="p-1.5 text-gray-300 dark:text-gray-700 cursor-not-allowed"
                            aria-label="未設定有效預覽連結"
                            title="未設定有效預覽連結"
                          >
                            <ExternalLink size={14} />
                          </span>
                        )}
                        <button
                          onClick={() => resetAdCounters(ad)}
                          className="text-xs text-gray-400 hover:text-red-500 px-2 py-1"
                        >
                          重置
                        </button>
                        <button
                          onClick={() => openEditAd(ad)}
                          className="text-xs text-gray-400 hover:text-pink-500 px-2 py-1 flex items-center gap-1"
                        >
                          <Pencil size={12} /> 編輯
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
                );
              })}
          </div>
        )}

        {tab === 'spots' && (
          <div className="space-y-3">
            <button
              onClick={openNewSpot}
              className="w-full bg-white dark:bg-gray-900 rounded-2xl p-3 border-2 border-dashed border-gray-300 dark:border-gray-700 text-gray-500 hover:text-pink-600 hover:border-pink-400 transition flex items-center justify-center gap-2 text-sm font-bold"
            >
              <Plus size={16} /> 新增景點
            </button>

            {/* Phase 3.4: search + filter bar — 646 spots need this */}
            <div className="space-y-2">
              <input
                type="search"
                placeholder="🔍 搜尋景點 / 城市 / 國家..."
                value={spotQuery}
                onChange={(e) => setSpotQuery(e.target.value)}
                className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none focus:border-pink-400"
              />
              <div className="flex flex-wrap gap-1.5">
                {['all', '歐洲', '美洲', '東亞', '東南亞', '中東', '非洲', '南亞', '大洋洲', '中亞', '北亞', '香港']
                  .map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRegionFilter(r)}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition ${
                        regionFilter === r
                          ? 'bg-pink-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                      }`}
                    >
                      {r === 'all' ? '全部' : r}
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => setMissingImageOnly(!missingImageOnly)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition ${
                    missingImageOnly
                      ? 'bg-orange-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                  }`}
                >
                  {missingImageOnly ? '✓ 缺圖' : '⚠️ 缺圖'}
                </button>
              </div>
            </div>

            {(() => {
              const q = spotQuery.toLowerCase().trim();
              const filtered = spots.filter((s) => {
                if (regionFilter !== 'all' && s.region !== regionFilter) return false;
                if (missingImageOnly && s.image) return false;
                if (!q) return true;
                return (
                  (s.name || '').toLowerCase().includes(q) ||
                  (s.nameEn || '').toLowerCase().includes(q) ||
                  (s.city || '').toLowerCase().includes(q) ||
                  (s.cityEn || '').toLowerCase().includes(q) ||
                  (s.country || '').toLowerCase().includes(q)
                );
              });
              const missingCount = spots.filter((s) => !s.image).length;
              return (
                <>
                  <div className="text-xs text-gray-500 px-1">
                    顯示 {filtered.length} / {spots.length} 個景點
                    {missingImageOnly && ` · ${missingCount} 個缺圖`}
                  </div>
                  {filtered.length === 0 ? (
                    <div className="text-center text-gray-400 py-12 text-sm">
                      {spots.length === 0 ? '尚未載入景點' : '沒有符合篩選的景點'}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {filtered.map((spot) => (
                        <button
                          key={spot.id}
                          type="button"
                          onClick={() => openEditSpot(spot)}
                          className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-200 dark:border-gray-800 text-left hover:shadow-md hover:border-pink-300 transition group"
                        >
                          <div className="relative">
                            <div
                              className="w-full h-32 bg-cover bg-center group-hover:scale-105 transition-transform duration-300"
                              style={{ backgroundImage: spot.image ? `url(${spot.image})` : 'none' }}
                            />
                            {!spot.image && (
                              <div className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-800 text-gray-400 text-xs font-bold">
                                缺圖
                              </div>
                            )}
                            <div className="absolute top-2 right-2 bg-black/60 text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                              <Pencil size={12} />
                            </div>
                          </div>
                          <div className="p-3">
                            <h3 className="font-bold text-sm text-gray-900 dark:text-white truncate">{spot.name}</h3>
                            <p className="text-xs text-gray-500 mt-1">{spot.city} · {spot.country}</p>
                            <span className="text-[10px] uppercase font-bold text-pink-600 mt-1 inline-block">
                              {spot.region || '—'}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        <div className="mt-8 p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-xl text-xs text-yellow-800 dark:text-yellow-200">
          💡 新增景點或廣告：按上面的「＋ 新增」按鈕。編輯現有項目：點擊卡片。所有改動會即時寫入 Firestore。
        </div>
      </div>

      {/* Edit modals — only one open at a time */}
      {editingSpot && (
        <SpotEditModal
          spot={editingSpot}
          isNew={spotIsNew}
          onClose={() => setEditingSpot(null)}
          onSaved={onSpotSaved}
          onDeleted={onSpotDeleted}
          adminMutate={adminMutate}
        />
      )}
      {editingAd && (
        <AdEditModal
          ad={editingAd}
          isNew={adIsNew}
          onClose={() => setEditingAd(null)}
          onSaved={onAdSaved}
          adminMutate={adminMutate}
        />
      )}
    </div>
  );
}
