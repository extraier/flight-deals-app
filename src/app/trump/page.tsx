'use client';

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import trumpData from '@/data/trump_alerts.json';
import futuAd from './futu_ad.jpg';

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
  text_cn?: string | null;
}

interface Trade {
  stock: string;
  ticker: string;
  transaction: string;
  filed: string;
  traded: string;
  return_pct: number | null;
  source: string;
}

const data = trumpData as unknown as {
  updated: string;
  posts: Post[];
  filings: Filing[];
  quiver_trades: Trade[];
};

type Tab = 'trades' | 'truth';

// Light/dark aware color helpers
function card(isDark: boolean) {
  return isDark
    ? 'bg-zinc-900/50 border-zinc-700 hover:border-zinc-600'
    : 'bg-white border-zinc-200 hover:border-zinc-400 shadow-sm';
}

function textMuted(isDark: boolean) {
  return isDark ? 'text-zinc-400' : 'text-zinc-500';
}

function textFaint(isDark: boolean) {
  return isDark ? 'text-zinc-600' : 'text-zinc-400';
}

function bgSurface(isDark: boolean) {
  return isDark ? 'bg-zinc-800' : 'bg-zinc-100';
}

function bgHeader(isDark: boolean) {
  return isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-100 border-zinc-300';
}

function borderSubtle(isDark: boolean) {
  return isDark ? 'border-zinc-700' : 'border-zinc-200';
}

function ReturnPill({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined) return <span className="text-zinc-400">—</span>;
  const pos = pct > 0;
  return (
    <span className={`font-bold ${pos ? 'text-emerald-500' : pct < 0 ? 'text-red-500' : 'text-zinc-400'}`}>
      {pos ? '+' : ''}{pct.toFixed(2)}%
    </span>
  );
}

function TransactionsTab({ isDark }: { isDark: boolean }) {
  const trades = data.quiver_trades || [];
  const filings = data.filings || [];

  if (trades.length === 0 && filings.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-400">
        <div className="text-4xl mb-4">📊</div>
        <div>暫無持股交易記錄</div>
        <div className={`text-sm mt-2 ${textFaint(isDark)}`}>數據來自 QuiverQuant · SEC EDGAR</div>
      </div>
    );
  }

  return (
    <div>
      {trades.length > 0 && (
        <>
          <div className="bg-gradient-to-r from-red-700 to-red-600 text-white px-4 py-2 rounded-lg mb-4 font-bold text-sm">
            📊 Trump 持股交易 <span className="font-normal opacity-80 text-xs">QuiverQuant</span>
          </div>
          <div className="overflow-x-auto" style={{ maxHeight: '400px', overflowY: 'auto' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className={`${bgSurface(isDark)} text-${isDark ? 'zinc-300' : 'zinc-700'}`}>
                  <th className="text-left p-3 rounded-tl-lg sticky top-0 z-10">股票</th>
                  <th className="text-left p-3 sticky top-0 z-10">交易</th>
                  <th className="text-left p-3 sticky top-0 z-10">申報日期</th>
                  <th className="text-left p-3 sticky top-0 z-10">交易日期</th>
                  <th className="text-left p-3 rounded-tr-lg sticky top-0 z-10">回報</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => {
                  const isPurchase = /Purchase|Buy/i.test(t.transaction);
                  const isSale = /Sale|Sell/i.test(t.transaction);
                  const amount = t.transaction.includes('\n') ? t.transaction.split('\n').pop()?.trim() : '';
                  return (
                    <tr key={i} className={`border-b ${borderSubtle(isDark)} ${isDark ? 'hover:bg-zinc-800/50' : 'hover:bg-zinc-50'}`}>
                      <td className="p-3 font-medium">
                        <div>{t.stock.split('\n')[0]}</div>
                        {t.ticker && <div className={`text-xs ${textFaint(isDark)}`}>{t.ticker}</div>}
                      </td>
                      <td className="p-3">
                        <span className={isPurchase ? 'text-emerald-500 font-bold' : isSale ? 'text-red-500 font-bold' : 'text-zinc-400'}>
                          {isPurchase ? '買入' : isSale ? '賣出' : t.transaction.slice(0, 10)}
                        </span>
                        {amount && <div className={`text-xs ${textFaint(isDark)}`}>{amount}</div>}
                      </td>
                      <td className={`p-3 ${textMuted(isDark)}`}>{t.filed}</td>
                      <td className={`p-3 ${textMuted(isDark)}`}>{t.traded}</td>
                      <td className="p-3"><ReturnPill pct={t.return_pct} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {filings.length > 0 && (
        <>
          <div className="bg-gradient-to-r from-orange-700 to-orange-600 text-white px-4 py-2 rounded-lg mb-4 font-bold text-sm mt-6">
            🏛️ SEC 持倉申報
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`${bgSurface(isDark)} text-${isDark ? 'zinc-300' : 'zinc-700'}`}>
                  <th className="text-left p-3 rounded-tl-lg">股票</th>
                  <th className="text-left p-3">交易</th>
                  <th className="text-left p-3">申報日期</th>
                  <th className="text-left p-3">交易日期</th>
                  <th className="text-left p-3 rounded-tr-lg">回報</th>
                </tr>
              </thead>
              <tbody>
                {filings.map((f, i) => {
                  const isPurchase = /Purchase|Buy/i.test(f.transaction);
                  const isSale = /Sale|Sell/i.test(f.transaction);
                  const pct = f.return_pct ? parseFloat(f.return_pct) : null;
                  return (
                    <tr key={i} className={`border-b ${borderSubtle(isDark)} ${isDark ? 'hover:bg-zinc-800/50' : 'hover:bg-zinc-50'}`}>
                      <td className="p-3 font-medium">{f.ticker} <span className={`text-xs ${textFaint(isDark)}`}>{f.company}</span></td>
                      <td className="p-3">
                        <span className={isPurchase ? 'text-emerald-500 font-bold' : isSale ? 'text-red-500 font-bold' : 'text-zinc-400'}>
                          {isPurchase ? '買入' : isSale ? '賣出' : f.transaction.slice(0, 10)}
                        </span>
                        <div className={`text-xs ${textFaint(isDark)}`}>{f.range}</div>
                      </td>
                      <td className={`p-3 ${textMuted(isDark)}`}>{f.date}</td>
                      <td className={`p-3 ${textMuted(isDark)}`}>{f.trade_date}</td>
                      <td className="p-3"><ReturnPill pct={pct} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function SourceBadge({ source, isDark }: { source: string; isDark: boolean }) {
  const configs: Record<string, { cls: string; label: string }> = {
    truth_social: { cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30', label: 'Truth Social' },
    justthenews: { cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', label: 'JustTheNews' },
  };
  const { cls, label } = configs[source] || { cls: `bg-zinc-500/20 ${isDark ? 'text-zinc-400' : 'text-zinc-600'} border-zinc-500/30`, label: source };
  return <span className={`text-xs px-2 py-0.5 rounded border ${cls}`}>{label}</span>;
}

function ConfidenceBadge({ text, isDark }: { text: string; isDark: boolean }) {
  const configs: Record<string, string> = {
    High: 'bg-red-500/20 text-red-400 border-red-500/30',
    Medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    Low: `bg-zinc-500/20 ${isDark ? 'text-zinc-400' : 'text-zinc-600'} border-zinc-500/30`,
  };
  return <span className={`text-xs px-2 py-0.5 rounded border ${configs[text] || configs.Low}`}>⚡ {text}</span>;
}

function TickerPill({ ticker }: { ticker: string }) {
  return <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-xs px-1.5 py-0.5 rounded font-bold">{ticker}</span>;
}

function PostCard({ post, isDark }: { post: Post; isDark: boolean }) {
  const tickers = (post.text.match(/\b[A-Z]{2,5}\b/g) || []).filter(t =>
    ['MSFT','NVDA','ORCL','ADBE','TSLA','AAPL','GOOGL','AMZN','META','NFLX','NOW','CDNS','TT','VOO','VTI','IWM'].includes(t)
  );
  const confidence = tickers.length > 0 ? 'High' : 'Medium';
  const displayText = post.text.length > 400 ? post.text.slice(0, 400) + '...' : post.text;

  return (
    <div className={`border rounded-lg ${card(isDark)} overflow-hidden`}>
      {post.image && (
        <img src={post.image} alt="Post image" className="w-full max-h-96 object-cover bg-black" loading="lazy" />
      )}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs ${textFaint(isDark)}`}>{post.date}</span>
            <SourceBadge source={post.source} isDark={isDark} />
            <ConfidenceBadge text={confidence} isDark={isDark} />
            {tickers.map(t => <TickerPill key={t} ticker={t} />)}
          </div>
          <span className={`text-xs ${textFaint(isDark)}`}>#{post.id}</span>
        </div>

        <p className={`text-sm leading-relaxed mb-2 whitespace-pre-wrap ${isDark ? 'text-zinc-100' : 'text-zinc-800'}`}>{displayText}</p>

        {post.text_cn && (
          <div className={`mt-3 pt-3 border-t ${borderSubtle(isDark)}`}>
            <div className="text-xs text-emerald-500 mb-1 font-medium">🇭🇰 粵語/繁體中文翻譯</div>
            <p className={`text-sm leading-relaxed whitespace-pre-wrap ${isDark ? 'text-zinc-300' : 'text-zinc-600'}`}>{post.text_cn}</p>
          </div>
        )}

        {post.text.includes('https://') && (
          <a href={post.link} target="_blank" rel="noopener noreferrer"
             className="text-xs text-blue-400 hover:text-blue-300 mt-2 inline-block">
            🔗 查看來源 →
          </a>
        )}
      </div>
    </div>
  );
}

function TruthSocialTab({ isDark }: { isDark: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const posts = data.posts || [];
  const visible = showAll ? posts : posts.slice(0, 5);
  return (
    <div className="space-y-3">
      {visible.map((post: Post) => (
        <PostCard key={post.id} post={post} isDark={isDark} />
      ))}
      {!showAll && posts.length > 5 && (
        <button
          onClick={() => setShowAll(true)}
          className={`w-full py-3 text-sm ${isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          Show {posts.length - 5} more posts ↓
        </button>
      )}
    </div>
  );
}

export default function TrumpPage() {
  const [tab, setTab] = useState<Tab>('trades');
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted ? resolvedTheme === 'dark' : true;
  const updated = data.updated?.replace('T', ' ').slice(0, 16) || '';

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className={`bg-gradient-to-r ${bgHeader(isDark)} px-6 py-8 border-b ${borderSubtle(isDark)}`}>
        <div className="max-w-3xl mx-auto">
          <h1 className={`text-3xl font-bold tracking-tight mb-1 ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>
            Trump Trump Scanner
          </h1>
          <p className={`text-sm ${textMuted(isDark)}`}>
            更新時間 {updated} · 每30分鐘自動更新
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className={`${bgSurface(isDark)} border-b ${borderSubtle(isDark)} px-6 py-3`}>
        <div className="max-w-3xl mx-auto flex gap-1 flex-wrap">
          <button
            onClick={() => setTab('trades')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'trades' ? 'bg-red-600 text-white' : `${bgSurface(isDark)} ${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'}`
            }`}
          >
            📊 持股交易
          </button>
          <button
            onClick={() => setTab('truth')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'truth' ? 'bg-blue-600 text-white' : `${bgSurface(isDark)} ${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'}`
            }`}
          >
            📱 Truth Social
          </button>
          {/* Cross-page Serenity navigation — two sub-tabs styled like inactive tabs */}
          <span className={`mx-1 ${textFaint(isDark)}`}>|</span>
          <a
            href="/serenity?tab=feed"
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${bgSurface(isDark)} ${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'}`}
            title="Serenity 推文動態"
          >
            📰 Serenity推文
          </a>
          <a
            href="/serenity?tab=performance"
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${bgSurface(isDark)} ${isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-700' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'}`}
            title="Serenity 持股回報"
          >
            📈 Serenity持股
          </a>
        </div>
      </div>

      {/* Futu Ad — shown at top for visibility */}
      <div className="max-w-3xl mx-auto px-4 pt-4 pb-2">
        <div style={{
          background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
          borderRadius: '12px',
          padding: '16px',
          textAlign: 'center',
          color: '#fff',
        }}>
          <img
            src={futuAd.src}
            alt="富途牛牛優惠"
            style={{ borderRadius: '8px', marginBottom: '12px', display: 'block', marginLeft: 'auto', marginRight: 'auto', width: '70%' }}
          />
          <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '10px' }}>
            🎁 Comparetiger 獨家 富途開戶即賺 $1,800 現金券！
          </div>
          <div style={{ fontSize: '13px', color: '#ddd', marginBottom: '8px' }}>
            用兌換碼【<span style={{ color: '#f39c12', fontWeight: 'bold' }}>COMPARE</span>】開戶，享一世免佣 + 高達 HK$1,800 現金券
          </div>
          <div style={{ fontSize: '12px', color: '#999' }}>
            📲 步驟：下載富途牛牛 APP → 活動中心 → 兌換中心 → 輸入【COMPARE】
          </div>
        </div>
      </div>

      {/* Content */}
      <div className={`max-w-3xl mx-auto px-4 py-6`}>
        {tab === 'trades' ? <TransactionsTab isDark={isDark} /> : <TruthSocialTab isDark={isDark} />}
      </div>

      {/* Footer */}
      <div className={`text-center text-xs py-6 border-t ${borderSubtle(isDark)} ${textFaint(isDark)}`}>
        數據來源：Truth Social · QuiverQuant · SEC EDGAR · 最後更新 {updated}
      </div>
    </div>
  );
}
