/**
 * Comparetiger 財經新聞 page
 *
 * Hermes 2026-08-03: Builds the public-facing news index at /news on the
 * flight-deals-app Vercel project. Embedded via iframe on WP page 10215
 * (https://comparetiger.com/?page_id=10215) so the Comparetiger site
 * hosts the data while we control the layout.
 *
 * Data source: comparetiger.com WP REST endpoint, fetching all published
 * posts in category id=1023 (the "財經" category). Server-side fetch
 * avoids CORS — this is a Next.js server component.
 *
 * Design: matches the Comparetiger visual language (#1a88ff primary,
 * #1a1a2e navy, #ff4444 deal-red, #f0f4ff card bg) without requiring
 * the page to import any of those sites' CSS. Cards stack vertically,
 * newest first, with per-source color-coded badges.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { ExternalLink, Newspaper } from 'lucide-react';

export const metadata = {
  title: '財經新聞 – Comparetiger',
  description: '即時財經新聞摘要 — 來源：華爾街見聞、財聯社、智通財經、格隆匯、AASTOCKS 等',
};

const COMP_BASE = process.env.COMPARETIGER_API_BASE || 'https://comparetiger.com';
const CATEGORY_ID = 1023; // 財經
const PER_PAGE = 30;

// —— Source colors ————————————————————————————————————
// Match Comparetiger's existing scanner-page colors so the news cards feel
// native next to the flight-deal pages.
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

function sourceColor(name: string) {
  return SOURCE_COLORS[name] || DEFAULT_COLOR;
}

// —— Types ————————————————————————————————————————

interface NewsPost {
  id: number;
  date_gmt: string;
  link: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  meta?: {
    futu_source_name?: string;
    futu_source_url?: string;
    futu_published_at?: string;
  };
}

interface WPResponse<T> {
  data: T[];
  headers: Record<string, string>;
}

// —— Data fetch ————————————————————————————————————
// Server-side only — avoids CORS, runs at request time so the page is
// always fresh without needing ISR config. We revalidate every 5 min
// so a refresh during high traffic doesn't hammer WP REST.
export const revalidate = 300;

async function fetchNews(): Promise<NewsPost[]> {
  // Hermes 2026-08-03: use ?rest_route= form (the wp-json prefix on this
  // Synology-hosted WP site returns 404 for unknown paths after a 301
  // redirect from /wp-json/ → /wp/v2/, which doesn't resolve correctly
  // through the Synology NAS frontend). The ?rest_route= form works
  // because it's served by index.php.
  const params = new URLSearchParams({
    rest_route: '/wp/v2/posts',
    categories: String(CATEGORY_ID),
    per_page: String(PER_PAGE),
    orderby: 'date',
    order: 'desc',
    status: 'publish',
    _fields: 'id,date_gmt,link,title.rendered,excerpt.rendered,meta.futu_source_name,meta.futu_source_url,meta.futu_published_at',
  });
  const url = `${COMP_BASE}/?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ComparetigerNewsBot/1.0 (+https://comparetiger.com)' },
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      console.error(`WP REST ${res.status}: ${await res.text().catch(() => '')}`);
      return [];
    }
    const posts = (await res.json()) as NewsPost[];
    return posts;
  } catch (e) {
    console.error('WP fetch failed:', e);
    return [];
  }
}

// —— Helpers ————————————————————————————————————

/**
 * Source name extraction — Comparetiger posts follow a "{Source}：{Title}"
 * convention in the excerpt field. We parse it out so the badge can show
 * the original publisher (智通財經, AASTOCKS, etc.) instead of "Comparetiger".
 *
 * If we can't extract a source, fall back to "Comparetiger".
 *
 * Known source list mirrors the rewrite.py normalization table.
 */
const KNOWN_SOURCES = [
  '華爾街見聞', '財聯社', '智通財經', '格隆匯', 'AASTOCKS',
  '金十數據', 'PR Newswire', '新浪科技', '新浪港股', 'TechWeb',
  '環球市場播報', '市場資訊',
];

function extractSource(excerptHtml: string): { name: string; cleanExcerpt: string } {
  // Strip tags
  const text = excerptHtml.replace(/<[^>]+>/g, '').trim();
  // Try "Name：..." or "Name: ..." at start (full-width colon from WP excerpts)
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

function stripHtml(html: string, max = 280): string {
  // Crude but sufficient — WordPress excerpt.rendered contains a single <p>
  // with plain text. We just strip tags and trim.
  const text = html.replace(/<[^>]+>/g, '').trim();
  if (text.length <= max) return text;
  // Cut at sentence boundary near max
  const slice = text.slice(0, max);
  const lastBreak = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'));
  if (lastBreak > max * 0.6) return slice.slice(0, lastBreak + 1) + '…';
  return slice + '…';
}

function formatTime(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    // Show in HKT regardless of server TZ
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

// —— Page ————————————————————————————————————

export default async function NewsPage() {
  const posts = await fetchNews();

  // Pick the post's original source URL (from meta) over the WP link —
  // the WP link goes to comparetiger.com/?p=ID which is the dashboard view,
  // but the meta.futu_source_url is the canonical "view original on Futu" link.
  const updated = posts[0]?.meta?.futu_published_at || posts[0]?.date_gmt;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="bg-gradient-to-r from-[#1a1a2e] to-[#1a88ff] text-white">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <Newspaper className="h-7 w-7" />
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">財經新聞</h1>
          </div>
          <p className="text-sm text-white/80">
            即時摘要 · 來源：華爾街見聞、財聯社、智通財經、格隆匯、AASTOCKS 等
            {updated && (
              <> · 最後更新 {formatTime(updated)}</>
            )}
          </p>
        </div>
      </header>

      {/* Body */}
      <main className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-4">
        {posts.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-muted-foreground">
              <Newspaper className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <div className="font-medium">暫無財經新聞</div>
              <div className="text-sm mt-1">稍後再試，或查看其他分類</div>
            </CardContent>
          </Card>
        )}

        {posts.map((post) => {
          // Hermes 2026-08-03: parse source name from the excerpt prefix
          // ("{Source}：{Title}") since the meta.futu_source_name field
          // isn't registered in WP and gets stripped by REST.
          const { name: sourceName, cleanExcerpt } = extractSource(post.excerpt.rendered);
          const sourceUrl = post.link;
          const sc = sourceColor(sourceName);
          const publishedAt = post.meta?.futu_published_at || post.date_gmt;

          return (
            <Card
              key={post.id}
              className="group/card hover:shadow-md transition-shadow"
            >
              <CardContent className="py-5">
                {/* Source + time row */}
                <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant="outline"
                      className={`${sc.bg} ${sc.fg} ${sc.border} border font-medium`}
                    >
                      {sourceName}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatTime(publishedAt)}
                    </span>
                  </div>
                </div>

                {/* Title */}
                <h2 className="text-base md:text-lg font-semibold leading-snug mb-2 text-foreground group-hover/card:text-primary transition-colors">
                  <Link
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    <span dangerouslySetInnerHTML={{ __html: post.title.rendered }} />
                    <ExternalLink className="inline-block ml-1.5 h-3.5 w-3.5 align-baseline opacity-60" />
                  </Link>
                </h2>

                {/* Excerpt */}
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {stripHtml(cleanExcerpt || post.excerpt.rendered, 240)}
                </p>

                {/* Footer */}
                <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between text-xs">
                  <Link
                    href={post.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    查看 Comparetiger 完整版本 →
                  </Link>
                  <span className="text-muted-foreground/60">
                    #ID {post.id}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Footer */}
        {posts.length > 0 && (
          <footer className="text-center text-xs text-muted-foreground/70 py-6 border-t border-border/50">
            <p>
              本頁為 Comparetiger 自動轉發之事實摘要，原文觀點及分析版權歸各原
              發佈機構（華爾街見聞、財聯社、智通財經、格隆匯、AASTOCKS 等）所有。
              如有出入，以原文為準。
            </p>
            <p className="mt-1">
              資料來源：
              <Link
                href="https://news.futunn.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline ml-1"
              >
                富途牛牛財經新聞
              </Link>
              {' '}· 每 5 分鐘自動更新
            </p>
          </footer>
        )}
      </main>
    </div>
  );
}