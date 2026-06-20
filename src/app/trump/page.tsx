'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import trumpData from '@/data/trump_alerts.json';

interface Filing {
  ticker: string;
  company: string;
  transaction: string;
  range: string;
  date: string;
  trade_date: string;
  return_pct: string | null;
}

interface Post {
  id: string;
  link: string;
  text: string;
  date: string;
  source: string;
  image: string | null;
  has_image: boolean;
}

const data = trumpData as unknown as {
  updated: string;
  posts: Post[];
  filings: Filing[];
};

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    truth_social: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    justthenews: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    default: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  };
  const cls = colors[source] || colors.default;
  const label: Record<string, string> = {
    truth_social: 'Truth Social',
    justthenews: 'JustTheNews',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${cls}`}>
      {label[source] || source}
    </span>
  );
}

function PostCard({ post }: { post: Post }) {
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [showTrans, setShowTrans] = useState(false);

  const translate = async () => {
    if (translated) { setShowTrans(!showTrans); return; }
    setTranslating(true);
    try {
      const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=${encodeURIComponent(post.text)}`);
      const arr = await res.json();
      setTranslated(arr[0].map((t: any) => t[0]).join(''));
      setShowTrans(true);
    } catch {
      setTranslated('繙譯失敗');
    }
    setTranslating(false);
  };

  const displayText = post.text.length > 300 ? post.text.slice(0, 300) + '...' : post.text;
  const hasLink = post.text.includes('https://');

  return (
    <div className="border border-zinc-700 rounded-lg p-4 bg-zinc-900/50 hover:border-zinc-600 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{post.date}</span>
          <SourceBadge source={post.source} />
        </div>
        <span className="text-xs text-zinc-600">#{post.id}</span>
      </div>

      <p className="text-sm text-zinc-100 leading-relaxed mb-2 whitespace-pre-wrap">{displayText}</p>

      {hasLink && (
        <a href={post.link} target="_blank" rel="noopener noreferrer"
           className="text-xs text-blue-400 hover:text-blue-300 mb-2 inline-block">
          🔗 查看來源 →
        </a>
      )}

      <button
        onClick={translate}
        className="text-xs text-zinc-400 hover:text-white mt-1 transition-colors"
      >
        {translating ? '翻譯中...' : translated && showTrans ? '🙈 隱藏中文' : '📖 中文翻譯'}
      </button>

      {showTrans && translated && (
        <p className="text-sm text-zinc-300 leading-relaxed mt-2 border-t border-zinc-700 pt-2 whitespace-pre-wrap">
          {translated}
        </p>
      )}
    </div>
  );
}

export default function TrumpPage() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-zinc-900 to-zinc-800 border-b border-zinc-700 px-6 py-8">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl font-bold tracking-tight mb-1">🦅 Trump Truth Scanner</h1>
          <p className="text-zinc-400 text-sm">
            Trump 真相社交 · 更新時間 {data.updated?.replace('T', ' ').slice(0, 16)}
          </p>
        </div>
      </div>

      {/* Info bar */}
      <div className="bg-zinc-900/80 border-b border-zinc-800 px-6 py-3">
        <div className="max-w-3xl mx-auto flex gap-6 text-xs text-zinc-500">
          <span>📝 {data.posts?.length || 0} 則動態</span>
          <span>📊 {data.filings?.length || 0} 持股交易</span>
          <span>🔄 每30分鐘自動更新</span>
        </div>
      </div>

      {/* Posts */}
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        {(data.posts || []).map((post: Post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-zinc-600 py-8">
        數據來源：Truth Social · JustTheNews · SEC EDGAR
      </div>
    </div>
  );
}
