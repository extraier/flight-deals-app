/**
 * Comparetiger 財經新聞 page — inline-expand
 *
 * Hermes 2026-08-03 (rev 2): Inlines the full article body when a card is
 * clicked, so users never leave the SPA. The previous design opened
 * posts in a new tab via "查看 Comparetiger 完整版本 →" — that was bad UX
 * and didn't help Comparetiger's ad metrics. New flow:
 *
 *   1. User visits /news → sees 8 cards (titles + excerpts + source + time)
 *   2. Clicks a card title → SPA expands the full rewritten article body
 *      inline (no navigation, no new tab, no iframe).
 *   3. To read the original source, user clicks "原文連結" at the end of
 *      the expanded article — that opens news.futunn.com in a new tab.
 *   4. Click another card → previous article collapses, new one expands.
 *
 * Data source: Comparetiger WP REST endpoint. We fetch the latest 8 posts
 * with full content.rendered (so the user can read the body without an
 * extra HTTP round-trip when they tap a card).
 *
 * Design: Comparetiger visual language (#1a88ff primary, #1a1a2e navy,
 * #f0f4ff card bg). Single-page app feel; no iframe, no Vercel proxy.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Newspaper } from 'lucide-react';
import { NewsList } from './news-list';
import { NewsPost, formatTime } from './news-types';

export const metadata = {
  title: '財經新聞 – Comparetiger',
  description: '即時財經新聞摘要 — 來源：華爾街見聞、財聯社、智通財經、格隆匯、AASTOCKS 等',
};

const COMP_BASE = process.env.COMPARETIGER_API_BASE || 'https://comparetiger.com';
const CATEGORY_ID = 1023; // 財經
const PER_PAGE = 8;

// —— Data fetch ————————————————————————————————————
// Server-side only — avoids CORS. We pass full content.rendered so the
// client component can render the article body inline without an extra
// fetch when a card is expanded.
export const revalidate = 300;

async function fetchNews(): Promise<NewsPost[]> {
  const params = new URLSearchParams({
    rest_route: '/wp/v2/posts',
    categories: String(CATEGORY_ID),
    per_page: String(PER_PAGE),
    orderby: 'date',
    order: 'desc',
    status: 'publish',
    _fields: 'id,date_gmt,link,title.rendered,excerpt.rendered,content.rendered',
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
    return (await res.json()) as NewsPost[];
  } catch (e) {
    console.error('WP fetch failed:', e);
    return [];
  }
}

// —— Page ————————————————————————————————————

export default async function NewsPage() {
  const posts = await fetchNews();
  const updated = posts[0]?.date_gmt;

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

      {/* Body — client component for inline expansion */}
      <NewsList posts={posts} />

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-4 md:px-6 pt-2 pb-8 text-center text-xs text-muted-foreground/70 border-t border-border/50">
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
    </div>
  );
}
