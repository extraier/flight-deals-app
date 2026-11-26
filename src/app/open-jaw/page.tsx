'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  formatSavingPct,
  visibleOpenJawCards,
  type OpenJawCard,
} from '@/lib/openJaw';

interface OpenJawResponse {
  date: string | null;
  searchedAt: string | null;
  deals: OpenJawCard[];
}

function hkd(amount: number): string {
  return `HK$${Math.round(amount).toLocaleString('en-HK')}`;
}

function formatReportDate(date: string | null, searchedAt: string | null): string {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    return `${year}年${month}月${day}日`;
  }
  if (!searchedAt) return '';
  const parsed = new Date(searchedAt);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export default function OpenJawPage() {
  const [deals, setDeals] = useState<OpenJawCard[]>([]);
  const [reportDate, setReportDate] = useState<string | null>(null);
  const [searchedAt, setSearchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function load() {
    setFetchError(null);
    try {
      const res = await fetch('/api/open-jaw', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as OpenJawResponse;
      setDeals(Array.isArray(json.deals) ? json.deals : []);
      setReportDate(json.date ?? null);
      setSearchedAt(json.searchedAt ?? null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => {
      load();
    });
  }, []);

  const cards = visibleOpenJawCards(deals);
  const updated = formatReportDate(reportDate, searchedAt);

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="mx-auto max-w-5xl px-4">
        <div className="mb-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            返回主頁
          </Link>
        </div>

        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">🎫 開口機票</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            先飛到另一個城市再開票 · 只顯示比香港直飛平常價平超過七成的組合
          </p>
          {updated && (
            <p className="mt-1 text-xs text-muted-foreground/80 inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              最新報告：{updated}
            </p>
          )}
        </div>

        {loading && cards.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <div className="text-4xl mb-3" aria-hidden>⏳</div>
              <p className="text-lg font-medium text-foreground">載入中…</p>
            </CardContent>
          </Card>
        ) : fetchError && cards.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <div className="text-4xl mb-3" aria-hidden>⚠️</div>
              <p className="text-lg font-medium text-foreground">暫時讀唔到開口機票</p>
              <p className="text-sm text-muted-foreground mt-2">請稍後再試。</p>
            </CardContent>
          </Card>
        ) : cards.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <div className="text-4xl mb-3" aria-hidden>🎫</div>
              <p className="text-lg font-medium text-foreground">暫時未有極端開口機票</p>
              <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                而家沒有比平常香港直飛平超過七成的開口組合。平到咁先會顯示喺度，一般價差唔會出現。
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {cards.map((card) => (
              <article key={card.id}>
                <Card className="border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className="shrink-0 text-2xl select-none pt-1" aria-hidden>🎫</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <h2 className="text-lg font-bold text-foreground">{card.title}</h2>
                            {card.dateLabel && (
                              <p className="text-sm text-foreground mt-1">{card.dateLabel}</p>
                            )}
                            {card.positioningSummary && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {card.positioningSummary}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <div className="flex items-baseline gap-2 justify-end flex-wrap">
                              <span className="text-xs text-muted-foreground line-through">
                                {hkd(card.directPrice)}
                              </span>
                              <span className="text-xs text-muted-foreground">平常直飛</span>
                              <span className="text-2xl font-bold text-emerald-600">
                                {hkd(card.packagePrice)}
                              </span>
                            </div>
                            <div className="mt-1 flex justify-end">
                              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold">
                                比直飛平 {formatSavingPct(card.savingPct)}%
                              </Badge>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              慳 {hkd(card.savingHkd)}
                            </p>
                          </div>
                        </div>
                        <p className="mt-2 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
                          未能在此訂位 · 開口機票只供參考
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
