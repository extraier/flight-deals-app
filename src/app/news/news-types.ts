/**
 * News types + helpers — pure server-side, no React.
 *
 * Hermes 2026-08-03: Split out from page.tsx so that page.tsx stays a
 * pure Server Component (it owns `metadata` export). The client
 * `news-list.tsx` imports these via a separate import path, so Turbopack
 * doesn't promote page.tsx to a client component.
 */

export interface NewsPost {
  id: number;
  date_gmt: string;
  link: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  content: { rendered: string };
}

// —— Source colors ————————————————————————————————————
// Match Comparetiger's existing scanner-page colors.
const SOURCE_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  '華爾街見聞': { bg: 'bg-blue-50',    fg: 'text-blue-700',    border: 'border-blue-200'   },
  '財聯社':     { bg: 'bg-rose-50',    fg: 'text-rose-700',    border: 'border-rose-200'   },
  '智通財經':   { bg: 'bg-emerald-50', fg: 'text-emerald-700', border: 'border-emerald-200'},
  '格隆匯':     { bg: 'bg-violet-50',  fg: 'text-violet-700',  border: 'border-violet-200' },
  'AASTOCKS':   { bg: 'bg-amber-50',   fg: 'text-amber-700',   border: 'border-amber-200'  },
  '金十數據':   { bg: 'bg-orange-50',  fg: 'text-orange-700',  border: 'border-orange-200' },
  'PR Newswire':{ bg: 'bg-sky-50',     fg: 'text-sky-700',     border: 'border-sky-200'    },
  '新浪科技':   { bg: 'bg-pink-50',    fg: 'text-pink-700',    border: 'border-pink-200'   },
  '新浪港股':   { bg: 'bg-pink-50',    fg: 'text-pink-700',    border: 'border-pink-200'   },
  'TechWeb':    { bg: 'bg-indigo-50',  fg: 'text-indigo-700',  border: 'border-indigo-200' },
  '環球市場播報':{ bg: 'bg-teal-50',   fg: 'text-teal-700',    border: 'border-teal-200'   },
  '市場資訊':   { bg: 'bg-slate-50',   fg: 'text-slate-700',   border: 'border-slate-200'  },
};
const DEFAULT_COLOR = { bg: 'bg-zinc-50', fg: 'text-zinc-700', border: 'border-zinc-200' };

export const KNOWN_SOURCES = [
  '華爾街見聞', '財聯社', '智通財經', '格隆匯', 'AASTOCKS',
  '金十數據', 'PR Newswire', '新浪科技', '新浪港股', 'TechWeb',
  '環球市場播報', '市場資訊',
];

export function extractSource(excerptHtml: string): { name: string; cleanExcerpt: string } {
  const text = excerptHtml.replace(/<[^>]+>/g, '').trim();
  for (const name of KNOWN_SOURCES) {
    const sep = text.startsWith(name + '：')
      ? '：'
      : text.startsWith(name + ':')
      ? ':'
      : null;
    if (sep) {
      return {
        name,
        cleanExcerpt: text.slice(name.length + sep.length).trim(),
      };
    }
  }
  return { name: 'Comparetiger', cleanExcerpt: text };
}

export function sourceColor(name: string) {
  return SOURCE_COLORS[name] || DEFAULT_COLOR;
}

export function stripHtml(html: string, max = 280): string {
  const text = html.replace(/<[^>]+>/g, '').trim();
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastBreak = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'));
  if (lastBreak > max * 0.6) return slice.slice(0, lastBreak + 1) + '…';
  return slice + '…';
}

export function formatTime(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}
