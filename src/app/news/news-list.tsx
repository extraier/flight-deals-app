'use client';

/**
 * NewsList — client component for the /news page.
 *
 * Renders the list of news cards. Clicking a card title toggles inline
 * expansion of the full article body (no navigation, no new tab). The
 * expanded state is lost on page reload, which is fine — users only
 * need to read one article at a time.
 *
 * The "原文連結" link is the only thing that opens a new tab (it's the
 * link to the original Futu article). All other navigation is in-tab.
 */

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, X, ChevronDown } from 'lucide-react';
import {
  NewsPost,
  extractSource,
  sourceColor,
  stripHtml,
  formatTime,
} from './news-types';

export function NewsList({ posts }: { posts: NewsPost[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (posts.length === 0) {
    return (
      <main className="max-w-4xl mx-auto px-4 md:px-6 py-6">
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            <div className="font-medium">暫無財經新聞</div>
            <div className="text-sm mt-1">稍後再試，或查看其他分類</div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-3">
      {posts.map((post) => (
        <NewsCard
          key={post.id}
          post={post}
          expanded={expandedId === post.id}
          onToggle={() =>
            setExpandedId((cur) => (cur === post.id ? null : post.id))
          }
        />
      ))}
    </main>
  );
}

function NewsCard({
  post,
  expanded,
  onToggle,
}: {
  post: NewsPost;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { name: sourceName, cleanExcerpt } = extractSource(post.excerpt.rendered);
  const sc = sourceColor(sourceName);

  // Clean title (strip HTML)
  const titleText = useMemo(
    () => post.title.rendered.replace(/<[^>]+>/g, ''),
    [post.title.rendered]
  );

  // Extract the "原文連結" URL from the rendered content.rendered (the
  // WP post footer always has <a href="...news.futunn.com...">原文連結</a>).
  const sourceUrl = useMemo(() => {
    const m = post.content.rendered.match(
      /href="(https?:\/\/news\.futunn\.com[^"]+)"[^>]*>原文連結</
    );
    return m ? m[1] : null;
  }, [post.content.rendered]);

  return (
    <Card
      className={`group/card transition-shadow hover:shadow-md ${
        expanded ? 'ring-2 ring-primary/30 shadow-md' : ''
      }`}
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
              {formatTime(post.date_gmt)}
            </span>
          </div>
          <span className="text-xs text-muted-foreground/60">#ID {post.id}</span>
        </div>

        {/* Title — clickable to expand */}
        <button
          onClick={onToggle}
          className="text-left w-full text-base md:text-lg font-semibold leading-snug mb-2 text-foreground group-hover/card:text-primary transition-colors hover:underline"
          aria-expanded={expanded}
        >
          {titleText}
          <ChevronDown
            className={`inline-block ml-1.5 h-4 w-4 align-baseline opacity-60 transition-transform ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Excerpt (always shown) */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          {stripHtml(cleanExcerpt || post.excerpt.rendered, 240)}
        </p>

        {/* Expanded body — full article content inline */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-border/50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground">
                📄 全文（已轉發自 {sourceName}）
              </span>
              <button
                onClick={onToggle}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                aria-label="收合全文"
              >
                <X className="h-3.5 w-3.5" />
                收合
              </button>
            </div>

            <article
              className="text-sm leading-relaxed text-foreground/90 [&>p]:my-2 [&>p]:leading-relaxed [&>strong]:font-semibold [&>em]:italic [&>em]:text-foreground/95 [&>a]:text-primary [&>a]:hover:underline"
              // The rewritten content is from Comparetiger's own WP REST,
              // sanitized by WP, so this is safe. We render full HTML to
              // preserve the rewritten sub-section <em> emphasis headers.
              dangerouslySetInnerHTML={{ __html: post.content.rendered }}
            />

            {/* Source attribution + original link */}
            <div className="mt-4 pt-3 border-t border-border/50 text-xs text-muted-foreground flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>
                本文為 Comparetiger 自動轉發之事實摘要，版權歸 {sourceName} 所有。
              </span>
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  原文連結 <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
