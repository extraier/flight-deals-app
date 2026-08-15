'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2, Image as ImageIcon, Trash2 } from 'lucide-react';
import type { AdminMutate } from './types';

export type SpotRow = {
  id: string;
  name: string;
  nameEn?: string;
  city: string;
  cityEn?: string;
  country: string;
  countryCode?: string;
  region?: string;
  image: string;
  imageCredit?: string;
  blurb?: string;
  tags?: string[];
  travelMood?: string[];
  priceLevel?: 1 | 2 | 3 | 4;
  dealCode?: string;
};

type Props = {
  spot: SpotRow | null;          // null = closed
  isNew: boolean;
  onClose: () => void;
  onSaved: (spot: SpotRow) => void;
  onDeleted?: (id: string) => void;
  adminMutate: AdminMutate;
};

const REGIONS = ['東南亞', '東北亞', '歐洲', '美洲', '大洋洲', '中東', '非洲', '中國大陸'];
const PRICE_LEVELS: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];

/**
 * Edit modal for coupleSpots. Editable fields cover what admins actually
 * need to fix: image URL, name (zh+en), city/country, blurb, region, tags,
 * price level, and image credit. Immutable: id, createdAt (server-side).
 *
 * Mobile-first modal (per react-modal-defensive-ux skill Phase 6):
 *   - max-h-[90dvh] not 90vh (iOS Safari URL-bar collapse)
 *   - pb-[env(safe-area-inset-bottom)] (home indicator gutter)
 *   - mobile: bottom-anchored with rounded top; desktop: centered
 *   - four close paths: X / Esc / backdrop / labeled button
 */
export function SpotEditModal({ spot, isNew, onClose, onSaved, onDeleted, adminMutate }: Props) {
  const [form, setForm] = useState<SpotRow | null>(spot);
  const [tagsInput, setTagsInput] = useState('');
  const [moodInput, setMoodInput] = useState('');
  const [imageError, setImageError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Sync state when the spot prop changes (modal opens)
  /* Hermes 2026-08-14: when the parent passes a different `spot`, reset
   * local form state to match. Same justification as AdEditModal — the
   * user edits arbitrary fields before save, so we can't derive form
   * from spot alone. The parent could remount via key={spot?.id} but
   * that would lose tagsInput/moodInput/imageError/busy state. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!spot) {
      setForm(null);
      return;
    }
    setForm({ ...spot });
    setTagsInput((spot.tags || []).join(', '));
    setMoodInput((spot.travelMood || []).join(', '));
    setImageError(false);
    setError('');
    setConfirmDelete(false);
  }, [spot]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Close on Escape (Phase 1: standard pattern from react-modal-defensive-ux)
  useEffect(() => {
    if (!spot) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [spot, busy, onClose]);

  // Lock body scroll while modal is open
  useEffect(() => {
    if (spot) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [spot]);

  if (!spot || !form) return null;

  const update = <K extends keyof SpotRow>(k: K, v: SpotRow[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  };

  const handleSave = async () => {
    if (!form.id.trim()) {
      setError('ID 必填');
      return;
    }
    if (!form.name.trim()) {
      setError('名稱必填');
      return;
    }
    if (!form.image.trim()) {
      setError('圖片 URL 必填');
      return;
    }
    if (imageError) {
      setError('圖片載入失敗，請換一張');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const travelMood = moodInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const payload: Record<string, unknown> = {
        id: form.id,
        name: form.name,
        nameEn: form.nameEn || '',
        city: form.city,
        cityEn: form.cityEn || '',
        country: form.country,
        countryCode: form.countryCode || '',
        region: form.region || '',
        image: form.image,
        imageCredit: form.imageCredit || '',
        blurb: form.blurb || '',
        tags,
        travelMood,
        priceLevel: form.priceLevel ?? 1,
        dealCode: form.dealCode || '',
      };
      // Strip empty strings so we don't accidentally clobber existing values with ''
      for (const k of Object.keys(payload)) {
        if (payload[k] === '') delete payload[k];
      }
      await adminMutate('coupleSpots', form.id, payload);
      onSaved({ ...form, tags, travelMood });
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError('儲存失敗: ' + (e.message || String(err)));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await adminMutate('coupleSpots', form.id, {}, { delete: true });
      onDeleted?.(form.id);
      onClose();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError('刪除失敗: ' + (e.message || String(err)));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="bg-white w-full max-w-2xl max-h-[90dvh] sm:max-h-[90vh] flex flex-col rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-black text-gray-900">{isNew ? '新增景點' : '編輯景點'}</h2>
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

        {/* Scrollable body */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          {/* Image preview */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">圖片預覽</label>
            <div
              className="w-full h-48 bg-gray-100 rounded-2xl bg-cover bg-center border border-gray-200 flex items-center justify-center overflow-hidden"
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
            {/* Hidden img to detect load failures */}
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

          <Field label="圖片來源 / 版權">
            <input
              type="text"
              value={form.imageCredit || ''}
              onChange={(e) => update('imageCredit', e.target.value)}
              placeholder="例：Unsplash / John Doe"
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="中文名稱 *">
              <input
                type="text"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
              />
            </Field>
            <Field label="英文名稱">
              <input
                type="text"
                value={form.nameEn || ''}
                onChange={(e) => update('nameEn', e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="城市 (中文) *">
              <input
                type="text"
                value={form.city}
                onChange={(e) => update('city', e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
              />
            </Field>
            <Field label="城市 (英文)">
              <input
                type="text"
                value={form.cityEn || ''}
                onChange={(e) => update('cityEn', e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="國家 *">
              <input
                type="text"
                value={form.country}
                onChange={(e) => update('country', e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
              />
            </Field>
            <Field label="國家代碼 (ISO-2)">
              <input
                type="text"
                value={form.countryCode || ''}
                onChange={(e) => update('countryCode', e.target.value.toUpperCase().slice(0, 2))}
                placeholder="例：TW, JP, TH"
                maxLength={2}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-pink-400"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="地區">
              <select
                value={form.region || ''}
                onChange={(e) => update('region', e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
              >
                <option value="">—</option>
                {REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label="價格等級 ($)">
              <select
                value={form.priceLevel || 1}
                onChange={(e) => update('priceLevel', Number(e.target.value) as 1 | 2 | 3 | 4)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
              >
                {PRICE_LEVELS.map((l) => (
                  <option key={l} value={l}>{'$'.repeat(l)}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="簡介">
            <textarea
              value={form.blurb || ''}
              onChange={(e) => update('blurb', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400 resize-none"
            />
          </Field>

          <Field label="標籤 (用逗號分隔)">
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="例：文化, 浪漫, 美食"
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
            />
          </Field>

          <Field label="旅行氛圍 (用逗號分隔)">
            <input
              type="text"
              value={moodInput}
              onChange={(e) => setMoodInput(e.target.value)}
              placeholder="例：浪漫, 放鬆, 冒險"
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
            />
          </Field>

          <Field label="機場代碼 (dealCode)">
            <input
              type="text"
              value={form.dealCode || ''}
              onChange={(e) => update('dealCode', e.target.value.toUpperCase())}
              placeholder="例：TPE, HKG, BKK"
              maxLength={4}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-pink-400"
            />
          </Field>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {confirmDelete && !isNew && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2 rounded-lg">
              ⚠️ 再按一次「刪除」確認，這個景點會永久消失。
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-2 p-4 border-t border-gray-200 flex-shrink-0 bg-gray-50"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <div>
            {!isNew && onDeleted && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className={`px-3 py-2 rounded-lg text-sm font-bold transition flex items-center gap-1.5 ${
                  confirmDelete
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'text-red-600 hover:bg-red-50'
                } disabled:opacity-30`}
              >
                <Trash2 className="w-4 h-4" />
                {confirmDelete ? '確認刪除？' : '刪除'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
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
