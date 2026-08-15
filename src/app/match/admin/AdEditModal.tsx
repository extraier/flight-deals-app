'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2, Image as ImageIcon } from 'lucide-react';
import type { AdminMutate } from './types';

export type AdRow = {
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

type Props = {
  ad: AdRow | null;
  isNew: boolean;
  onClose: () => void;
  onSaved: (ad: AdRow) => void;
  adminMutate: AdminMutate;
};

/**
 * Edit modal for coupleAds. Fields covered: image URL with live preview,
 * title, body, CTA label + click URL, sponsor, active toggle, budget cap.
 * Counters (impressions/clicks) shown read-only — those have dedicated reset
 * buttons on the admin list to avoid accidental wipes.
 *
 * Mobile-first: max-h-[90dvh], env(safe-area-inset-bottom), four close paths.
 */
export function AdEditModal({ ad, isNew, onClose, onSaved, adminMutate }: Props) {
  const [form, setForm] = useState<AdRow | null>(ad);
  const [imageError, setImageError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  /* Hermes 2026-08-14: when the parent passes a different `ad`, reset
   * the local form state to match. This is the standard React pattern
   * for "controlled component receiving new props" — the React docs'
   * preferred alternative (deriving state during render with a
   * previousValue ref) doesn't fit our case because the user edits
   * arbitrary fields before save, so we can't derive form from ad
   * alone. The parent could force a remount via key={ad?.id} but that
   * would lose other internal state (imageError, busy). */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!ad) {
      setForm(null);
      return;
    }
    setForm({ ...ad });
    setImageError(false);
    setError('');
  }, [ad]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!ad) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [ad, busy, onClose]);

  useEffect(() => {
    if (ad) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [ad]);

  if (!ad || !form) return null;

  const update = <K extends keyof AdRow>(k: K, v: AdRow[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  };

  const isValidUrl = (s: string) => {
    if (!s) return false;
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const handleSave = async () => {
    if (!form.id.trim()) {
      setError('ID 必填');
      return;
    }
    if (!form.title.trim()) {
      setError('標題必填');
      return;
    }
    if (!form.sponsor.trim()) {
      setError('贊助商必填');
      return;
    }
    if (!isValidUrl(form.image)) {
      setError('圖片 URL 無效');
      return;
    }
    if (!isValidUrl(form.clickUrl)) {
      setError('點擊連結 URL 無效 (必須 http/https)');
      return;
    }
    if (imageError) {
      setError('圖片載入失敗，請換一張');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        id: form.id,
        sponsor: form.sponsor,
        title: form.title,
        image: form.image,
        body: form.body,
        ctaLabel: form.ctaLabel,
        clickUrl: form.clickUrl,
        active: form.active,
        budget: form.budget || null,
      };
      // Strip empty strings
      for (const k of Object.keys(payload)) {
        if (payload[k] === '') delete payload[k];
      }
      await adminMutate('coupleAds', form.id, payload);
      onSaved({ ...form });
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError('儲存失敗: ' + (e.message || String(err)));
    } finally {
      setBusy(false);
    }
  };

  const ctr = form.impressions > 0 ? (form.clicks / form.impressions) * 100 : 0;

  return (
    <div
      className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="bg-white w-full max-w-xl max-h-[90dvh] sm:max-h-[90vh] flex flex-col rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
        }}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-black text-gray-900">{isNew ? '新增廣告' : '編輯廣告'}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{form.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="關閉"
            className="p-2 text-gray-400 hover:text-gray-700 disabled:opacity-30 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          className="flex-1 overflow-y-auto p-4 space-y-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          {/* Image preview */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">圖片預覽</label>
            <div
              className="w-full h-40 bg-gray-100 rounded-2xl bg-cover bg-center border border-gray-200 flex items-center justify-center overflow-hidden"
              style={{ backgroundImage: form.image ? `url(${form.image})` : undefined }}
            >
              {(!form.image || imageError) && (
                <div className="text-center text-gray-400">
                  <ImageIcon className="w-10 h-10 mx-auto mb-1" />
                  <p className="text-xs">{form.image ? '圖片載入失敗' : '尚未填寫 URL'}</p>
                </div>
              )}
            </div>
          </div>

          <Field label="圖片 URL *">
            <input
              type="url"
              value={form.image}
              onChange={(e) => {
                update('image', e.target.value);
                setImageError(false);
              }}
              placeholder="https://..."
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
            />
            {form.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.image}
                alt=""
                className="hidden"
                onLoad={() => setImageError(false)}
                onError={() => setImageError(true)}
              />
            )}
            {imageError && (
              <p className="text-xs text-red-600 mt-1">⚠️ 圖片無法載入，請檢查 URL</p>
            )}
          </Field>

          <Field label="贊助商 *">
            <input
              type="text"
              value={form.sponsor}
              onChange={(e) => update('sponsor', e.target.value)}
              placeholder="例：Comparetiger"
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
            />
          </Field>

          <Field label="標題 *">
            <input
              type="text"
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              placeholder="例：搜尋最平機票"
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
            />
          </Field>

          <Field label="文案">
            <textarea
              value={form.body}
              onChange={(e) => update('body', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400 resize-none"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="按鈕文字 *">
              <input
                type="text"
                value={form.ctaLabel}
                onChange={(e) => update('ctaLabel', e.target.value)}
                placeholder="例：立即搜尋"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
              />
            </Field>
            <Field label="預算上限 (曝光數)">
              <input
                type="number"
                min={0}
                value={form.budget ?? ''}
                onChange={(e) => update('budget', e.target.value === '' ? undefined : Number(e.target.value))}
                placeholder="不限"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
              />
            </Field>
          </div>

          <Field label="點擊連結 (clickUrl) *">
            <input
              type="url"
              value={form.clickUrl}
              onChange={(e) => update('clickUrl', e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-pink-400"
            />
          </Field>

          <div className="flex items-center gap-3 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => update('active', e.target.checked)}
                className="w-4 h-4 rounded text-pink-500 focus:ring-pink-400"
              />
              <span className="text-sm font-bold text-gray-700">啟用廣告</span>
            </label>
          </div>

          {!isNew && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
              <div className="font-bold text-gray-500 uppercase mb-1">統計 (唯讀)</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-black text-gray-900">{form.impressions}</div>
                  <div>曝光</div>
                </div>
                <div>
                  <div className="text-lg font-black text-gray-900">{form.clicks}</div>
                  <div>點擊</div>
                </div>
                <div>
                  <div className="text-lg font-black text-gray-900">{ctr.toFixed(1)}%</div>
                  <div>CTR</div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 p-4 border-t border-gray-200 flex-shrink-0 bg-gray-50"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-200 disabled:opacity-30"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="px-5 py-2 rounded-lg text-sm font-bold bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {busy ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">{label}</label>
      {children}
    </div>
  );
}
