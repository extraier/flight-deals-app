'use client';

import { useState } from 'react';
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

function ReturnPill({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined) return <span className="text-zinc-500">—</span>;
  const pos = pct > 0;
  return (
    <span className={`font-bold ${pos ? 'text-emerald-400' : pct < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
      {pos ? '+' : ''}{pct.toFixed(2)}%
    </span>
  );
}

function TransactionsTab() {
  const trades = data.quiver_trades || [];
  const filings = data.filings || [];

  if (trades.length === 0 && filings.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <div className="text-4xl mb-4">📊</div>
        <div>暫無持股交易記錄</div>
        <div className="text-sm mt-2 text-zinc-600">數據來自 QuiverQuant · SEC EDGAR</div>
      </div>
    );
  }

  return (
    <div>
      {trades.length > 0 && (
        <>
          <div className="bg-gradient-to-r from-red-900/80 to-red-800/60 text-white px-4 py-2 rounded-lg mb-4 font-bold text-sm flex items-center gap-2">
            📊 Trump 持股交易 <span className="text-zinc-300 font-normal text-xs">QuiverQuant</span>
          </div>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-800 text-zinc-300">
                  <th className="text-left p-3 rounded-tl-lg">股票</th>
                  <th className="text-left p-3">交易</th>
                  <th className="text-left p-3">申報日期</th>
                  <th className="text-left p-3">交易日期</th>
                  <th className="text-left p-3 rounded-tr-lg">回報</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => {
                  const isPurchase = /Purchase|Buy/i.test(t.transaction);
                  const isSale = /Sale|Sell/i.test(t.transaction);
                  const amount = t.transaction.includes('\n') ? t.transaction.split('\n').pop()?.trim() : '';
                  return (
                    <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-900/50">
                      <td className="p-3 font-medium">
                        <div>{t.stock.split('\n')[0]}</div>
                        {t.ticker && <div className="text-xs text-zinc-500">{t.ticker}</div>}
                      </td>
                      <td className="p-3">
                        <span className={isPurchase ? 'text-emerald-400 font-bold' : isSale ? 'text-red-400 font-bold' : 'text-zinc-300'}>
                          {isPurchase ? '買入' : isSale ? '賣出' : t.transaction.slice(0, 10)}
                        </span>
                        {amount && <div className="text-xs text-zinc-500">{amount}</div>}
                      </td>
                      <td className="p-3 text-zinc-400">{t.filed}</td>
                      <td className="p-3 text-zinc-400">{t.traded}</td>
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
          <div className="bg-gradient-to-r from-orange-900/80 to-orange-800/60 text-white px-4 py-2 rounded-lg mb-4 font-bold text-sm">
            🏛️ SEC 持倉申報
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-800 text-zinc-300">
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
                    <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-900/50">
                      <td className="p-3 font-medium">{f.ticker} <span className="text-zinc-500 text-xs">{f.company}</span></td>
                      <td className="p-3">
                        <span className={isPurchase ? 'text-emerald-400 font-bold' : isSale ? 'text-red-400 font-bold' : 'text-zinc-300'}>
                          {isPurchase ? '買入' : isSale ? '賣出' : f.transaction.slice(0, 10)}
                        </span>
                        <div className="text-xs text-zinc-500">{f.range}</div>
                      </td>
                      <td className="p-3 text-zinc-400">{f.date}</td>
                      <td className="p-3 text-zinc-400">{f.trade_date}</td>
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

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    truth_social: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    justthenews: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    default: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  };
  const labels: Record<string, string> = {
    truth_social: 'Truth Social',
    justthenews: 'JustTheNews',
  };
  const cls = colors[source] || colors.default;
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${cls}`}>
      {labels[source] || source}
    </span>
  );
}

function ConfidenceBadge({ text }: { text: string }) {
  const colorMap: Record<string, string> = {
    High: 'bg-red-500/20 text-red-400 border-red-500/30',
    Medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    Low: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${colorMap[text] || colorMap.Low}`}>
      ⚡ {text}
    </span>
  );
}

function TickerPill({ ticker }: { ticker: string }) {
  return (
    <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-xs px-1.5 py-0.5 rounded font-bold">
      {ticker}
    </span>
  );
}

function PostCard({ post }: { post: Post }) {
  const tickers = (post.text.match(/\b[A-Z]{2,5}\b/g) || []).filter(t =>
    ['MSFT','NVDA','ORCL','ADBE','TSLA','AAPL','GOOGL','AMZN','META','NFLX','NOW','CDNS','TT','VOO','VTI','IWM','VTI'].includes(t)
  );
  const confidence = tickers.length > 0 ? 'High' : 'Medium';
  const displayText = post.text.length > 400 ? post.text.slice(0, 400) + '...' : post.text;

  return (
    <div className="border border-zinc-700 rounded-lg bg-zinc-900/50 hover:border-zinc-600 transition-colors overflow-hidden">
      {post.image && (
        <img
          src={post.image}
          alt="Post image"
          className="w-full max-h-96 object-cover bg-black"
          loading="lazy"
        />
      )}

      <div className="p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-500">{post.date}</span>
            <SourceBadge source={post.source} />
            <ConfidenceBadge text={confidence} />
            {tickers.map(t => <TickerPill key={t} ticker={t} />)}
          </div>
          <span className="text-xs text-zinc-600">#{post.id}</span>
        </div>

        <p className="text-sm text-zinc-100 leading-relaxed mb-2 whitespace-pre-wrap">{displayText}</p>

        {post.text_cn && (
          <div className="mt-3 pt-3 border-t border-zinc-700">
            <div className="text-xs text-emerald-400 mb-1 font-medium">🇭🇰 粵語/繁體中文翻譯</div>
            <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{post.text_cn}</p>
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

function TruthSocialTab() {
  return (
    <div className="space-y-3">
      {(data.posts || []).map((post: Post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}

export default function TrumpPage() {
  const [tab, setTab] = useState<Tab>('trades');
  const updated = data.updated?.replace('T', ' ').slice(0, 16) || '';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-zinc-900 to-zinc-800 border-b border-zinc-700 px-6 py-8">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl font-bold tracking-tight mb-1">🦅 Trump Truth Scanner</h1>
          <p className="text-zinc-400 text-sm">
            更新時間 {updated} · 每30分鐘自動更新
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-zinc-900/80 border-b border-zinc-800 px-6 py-3">
        <div className="max-w-3xl mx-auto flex gap-1">
          <button
            onClick={() => setTab('trades')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'trades'
                ? 'bg-red-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
            }`}
          >
            📊 持股交易
          </button>
          <button
            onClick={() => setTab('truth')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'truth'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
            }`}
          >
            📱 真相發文
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-6">
        {tab === 'trades' ? <TransactionsTab /> : <TruthSocialTab />}
      </div>

      {/* Futu Ad */}
      <div className="max-w-3xl mx-auto px-4 pb-6">
        <div style={{
          background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
          borderRadius: '12px',
          padding: '20px',
          textAlign: 'center',
          color: '#fff',
        }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '15px' }}>
            🎁 Comparetiger 獨家 富途開戶即賺 $1,800 現金券！
          </div>
          <div style={{ fontSize: '14px', lineHeight: '1.7', marginBottom: '15px', color: '#ddd' }}>
            用專屬兌換碼【<span style={{ color: '#f39c12', fontWeight: 'bold' }}>COMPARE</span>】開立富途牛牛戶口，
            除咗享一世免佣，仲送高達 <strong>HK$1,800 現金券</strong>（係真現金券，絕非贈股）！
            達標自動派發，唔使抽獎！
          </div>
          <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '8px', padding: '12px', marginBottom: '15px', textAlign: 'left' }}>
            <div style={{ fontSize: '13px', color: '#ccc', marginBottom: '8px' }}>📲 簡單領獎 3 步曲：</div>
            <div style={{ fontSize: '13px', color: '#fff' }}>1️⃣ 手機下載並登入「富途牛牛」APP</div>
            <div style={{ fontSize: '13px', color: '#fff' }}>2️⃣ 撳右下角「我的」→「活動中心」→「兌換中心」</div>
            <div style={{ fontSize: '13px', color: '#fff' }}>3️⃣ 發起開戶前輸入兌換碼【COMPARE】，並成功開通港美股戶口</div>
          </div>
          <div style={{ background: 'rgba(243,156,18,0.2)', border: '1px solid #f39c12', borderRadius: '8px', padding: '12px', textAlign: 'left' }}>
            <div style={{ fontSize: '14px', color: '#f39c12', fontWeight: 'bold', marginBottom: '8px' }}>
              💰 迎新雙重賞（可疊加，賺盡 $1,800！）：
            </div>
            <div style={{ fontSize: '13px', color: '#fff' }}>賞 1：存入資金達 HK$10,000 並放夠 60 日 👉 送 HK$800 獎賞</div>
            <div style={{ fontSize: '13px', color: '#fff' }}>賞 2：存入資金達 HK$80,000 並放夠 60 日 👉 再送 HK$1,000 獎賞</div>
          </div>
          <div style={{ fontSize: '12px', color: '#999', marginTop: '12px' }}>
            💡 提提你：喺 60 日期間，戶口入面嘅資金可以任你自由買賣，冇交易次數限制，邊投資邊賺迎新回報！
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-zinc-600 py-6 border-t border-zinc-800">
        數據來源：Truth Social · QuiverQuant · SEC EDGAR · 最後更新 {updated}
      </div>
    </div>
  );
}
