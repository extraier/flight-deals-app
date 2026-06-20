'use client';

import { useState, useMemo } from 'react';
import worldcupData from '@/data/worldcup_latest.json';

type Window = '1h' | '4h' | '24h';

interface Odds { home: number | null; draw: number | null; away: number | null; }
interface Changes { hkjc_home: number | null; hkjc_draw: number | null; hkjc_away: number | null; }
interface Match {
  match: string;
  homeTeam: string;
  awayTeam: string;
  gameTime: string;
  hkjc: Odds;
  poly: Odds;
  chg_1h?: Changes;
  chg_4h?: Changes;
  chg_24h?: Changes;
}

const data = worldcupData as {
  matches: Match[];
  generated: string;
  latest_datetime: string;
  ref_1h: string | null;
  ref_4h: string | null;
  ref_24h: string | null;
};

function fmt(n: number | null): string {
  if (n === null) return '—';
  return n.toFixed(2);
}

function fmtPct(n: number | null): string {
  if (n === null) return '—';
  return (n * 100).toFixed(1) + '%';
}

const TEAM_CN: Record<string, string> = {
  'Algeria': '阿爾及利亞',
  'Argentina': '阿根廷',
  'Australia': '澳洲',
  'Austria': '奧地利',
  'Belgium': '比利時',
  'Bosnia and Herzegovina': '波斯尼亞',
  'Brazil': '巴西',
  'Cabo Verde': '佛得角',
  'Canada': '加拿大',
  'Colombia': '哥倫比亞',
  'Croatia': '克羅地亞',
  'Curaçao': '古拉索',
  'Czechia': '捷克',
  "Côte d'Ivoire": '科特迪瓦',
  'DR Congo': '剛果民主共和國',
  'Ecuador': '厄瓜多爾',
  'Egypt': '埃及',
  'England': '英格蘭',
  'France': '法國',
  'Germany': '德國',
  'Ghana': '加納',
  'Haiti': '海地',
  'IR Iran': '伊朗',
  'Iraq': '伊拉克',
  'Japan': '日本',
  'Jordan': '約旦',
  'Korea Republic': '南韓',
  'Mexico': '墨西哥',
  'Morocco': '摩洛哥',
  'Netherlands': '荷蘭',
  'New Zealand': '新西蘭',
  'Norway': '挪威',
  'Panama': '巴拿馬',
  'Paraguay': '巴拉圭',
  'Portugal': '葡萄牙',
  'Qatar': '卡塔爾',
  'Saudi Arabia': '沙特阿拉伯',
  'Scotland': '蘇格蘭',
  'Senegal': '塞內加爾',
  'South Africa': '南非',
  'Spain': '西班牙',
  'Sweden': '瑞典',
  'Switzerland': '瑞士',
  'Tunisia': '突尼斯',
  'Türkiye': '土耳其',
  'United States': '美國',
  'Uruguay': '烏拉圭',
  'Uzbekistan': '烏茲別克斯坦',
};

function arrow(v: number | null): string {
  if (v === null || v === 0) return '→';
  return v > 0 ? '↑' : '↓';
}

function changeColor(v: number | null, inverse = false): string {
  if (v === null || v === 0) return 'text-muted-foreground';
  // For HK odds: higher = worse = green (good value), lower = worse = red
  // inverse = true means lower is BETTER (like home odds dropping)
  if (inverse) return v < 0 ? 'text-emerald-400' : 'text-red-400';
  return v > 0 ? 'text-emerald-400' : 'text-red-400';
}

function sortLabel(w: Window): string {
  return { '1h': '1小時前', '4h': '4小時前', '24h': '24小時前' }[w];
}

export default function WorldCupPage() {
  const [window, setWindow] = useState<Window>('24h');
  const [sortBy, setSortBy] = useState<'time' | 'change'>('time');

  const refLabel = data[`ref_${window}`] as string | null;

  const rows = useMemo(() => {
    const chgKey = `chg_${window}` as 'chg_1h' | 'chg_4h' | 'chg_24h';
    let r = [...data.matches];

    if (sortBy === 'change') {
      r.sort((a, b) => {
        const ca = Math.abs(a[chgKey]?.hkjc_home ?? 0);
        const cb = Math.abs(b[chgKey]?.hkjc_home ?? 0);
        return cb - ca;
      });
    } else {
      r.sort((a, b) => (a.gameTime || '').localeCompare(b.gameTime || ''));
    }
    return r;
  }, [window, sortBy]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-8">

        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight">🏆 世界盃赔率走勢</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            更新 {data.latest_datetime?.replace('_', ' ')} HKT · 馬會 1x2 + Polymarket 概率
          </p>
        </div>

        {/* Controls */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          {/* Window selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">比較：</span>
            <div className="inline-flex rounded-lg border border-border bg-card p-1 gap-1">
              {(['1h', '4h', '24h'] as Window[]).map(w => (
                <button
                  key={w}
                  onClick={() => setWindow(w)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    window === w
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {sortLabel(w)}
                </button>
              ))}
            </div>
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">排序：</span>
            <button
              onClick={() => setSortBy('time')}
              className={`px-3 py-1.5 rounded-md text-sm transition-all ${
                sortBy === 'time' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              ⏰ 時間
            </button>
            <button
              onClick={() => setSortBy('change')}
              className={`px-3 py-1.5 rounded-md text-sm transition-all ${
                sortBy === 'change' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              📈 變動
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary border-b border-border">
                <th className="py-3 px-4 text-left text-muted-foreground font-medium">賽事</th>
                <th className="py-3 px-3 text-center text-muted-foreground font-medium">時間</th>
                <th className="py-3 px-3 text-center text-muted-foreground font-medium">主勝</th>
                <th className="py-3 px-3 text-center text-muted-foreground font-medium">和局</th>
                <th className="py-3 px-3 text-center text-muted-foreground font-medium">客勝</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((match, i) => {
                const chg = match[`chg_${window}` as keyof Match] as Changes | undefined;
                const h = match.hkjc;
                const p = match.poly;
                const gt = match.gameTime || '';
                const gameDate = gt ? gt.slice(5, 10) : '';
                const gameHour = gt.includes('T') ? gt.slice(11, 16) : gt.slice(11, 16);

                return (
                  <>
                    {/* HKJC row */}
                    <tr key={`${i}-hkjc`} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                      {/* Match + time */}
                      <td className="py-2 px-4">
                        <div className="font-medium text-sm">{TEAM_CN[match.homeTeam] || match.homeTeam}</div>
                        <div className="text-xs text-muted-foreground">vs</div>
                        <div className="font-medium text-sm">{TEAM_CN[match.awayTeam] || match.awayTeam}</div>
                      </td>
                      <td className="py-2 px-3 text-center text-xs text-muted-foreground whitespace-nowrap">
                        {gameDate}<br/>{gameHour}
                      </td>
                      {/* HKJC odds */}
                      <td className="py-2 px-3 text-center">
                        <div className="flex flex-col items-center">
                          <span className="font-bold text-emerald-400 text-sm">{fmt(h.home)}</span>
                          {chg && (
                            <span className={`text-xs ${changeColor(chg.hkjc_home, true)}`}>
                              {arrow(chg.hkjc_home)}{Math.abs(chg.hkjc_home ?? 0).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex flex-col items-center">
                          <span className="font-bold text-sm">{fmt(h.draw)}</span>
                          {chg && (
                            <span className={`text-xs ${changeColor(chg.hkjc_draw, false)}`}>
                              {arrow(chg.hkjc_draw)}{Math.abs(chg.hkjc_draw ?? 0).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex flex-col items-center">
                          <span className="font-bold text-red-400 text-sm">{fmt(h.away)}</span>
                          {chg && (
                            <span className={`text-xs ${changeColor(chg.hkjc_away, true)}`}>
                              {arrow(chg.hkjc_away)}{Math.abs(chg.hkjc_away ?? 0).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Polymarket row */}
                    <tr key={`${i}-poly`} className="border-b border-border/30 bg-secondary/20">
                      <td className="py-1.5 px-4">
                        <span className="text-xs text-muted-foreground ml-2">Polymarket</span>
                      </td>
                      <td className="py-1.5 px-3"></td>
                      <td className="py-1.5 px-3 text-center">
                        <span className="text-sky-400 text-xs">{fmtPct(p.home)}</span>
                      </td>
                      <td className="py-1.5 px-3 text-center">
                        <span className="text-xs">{fmtPct(p.draw)}</span>
                      </td>
                      <td className="py-1.5 px-3 text-center">
                        <span className="text-orange-400 text-xs">{fmtPct(p.away)}</span>
                      </td>
                    </tr>
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-muted-foreground text-center">
          赔率變動：↑ = 升 · ↓ = 跌 · → = 不變 · 馬會 = 十進制赔率 · Polymarket = 隱含概率
        </p>
      </div>
    </div>
  );
}
