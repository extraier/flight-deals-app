'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import worldcupData from '@/data/worldcup_latest.json';

type Window = '1h' | '4h' | '24h';

interface Odds { home: number | null; draw: number | null; away: number | null; }
interface Changes {
  hkjc_home: number | null; hkjc_draw: number | null; hkjc_away: number | null;
  poly_home: number | null; poly_draw: number | null; poly_away: number | null;
}
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

const data = worldcupData as unknown as {
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

function fmtDateCN(dt: string): string {
  if (!dt) return '';
  const [date, time] = dt.split(' ');
  const [y, m, d] = date.split('-');
  return `${parseInt(m)}月${parseInt(d)}日 ${time}`;
}

function arrow(v: number | null): string {
  // null = no baseline (hide). 0 = baseline existed but no movement (hide too —
  // we don't want noise on rows that didn't actually change).
  if (v === null || v === 0) return '';
  return v > 0 ? '↑' : '↓';
}

function chgColor(v: number | null, inverse = false): string {
  if (v === null || v === 0) return '';
  if (inverse) return v < 0 ? 'text-emerald-400' : 'text-red-400';
  return v > 0 ? 'text-emerald-400' : 'text-red-400';
}

const TEAM_CN: Record<string, string> = {
  'Algeria': '阿爾及利亞', 'Argentina': '阿根廷', 'Australia': '澳洲', 'Austria': '奧地利',
  'Belgium': '比利時', 'Bosnia and Herzegovina': '波斯尼亞', 'Brazil': '巴西', 'Cabo Verde': '佛得角',
  'Canada': '加拿大', 'Colombia': '哥倫比亞', 'Croatia': '克羅地亞', 'Curaçao': '古拉索',
  'Czechia': '捷克', "Côte d'Ivoire": '科特迪瓦', 'DR Congo': '剛果民主共和國', 'Ecuador': '厄瓜多爾',
  'Egypt': '埃及', 'England': '英格蘭', 'France': '法國', 'Germany': '德國', 'Ghana': '加納',
  'Haiti': '海地', 'IR Iran': '伊朗', 'Iraq': '伊拉克', 'Japan': '日本', 'Jordan': '約旦',
  'Korea Republic': '南韓', 'Mexico': '墨西哥', 'Morocco': '摩洛哥', 'Netherlands': '荷蘭',
  'New Zealand': '新西蘭', 'Norway': '挪威', 'Panama': '巴拿馬', 'Paraguay': '巴拉圭',
  'Portugal': '葡萄牙', 'Qatar': '卡塔爾', 'Saudi Arabia': '沙特阿拉伯', 'Scotland': '蘇格蘭',
  'Senegal': '塞內加爾', 'South Africa': '南非', 'Spain': '西班牙', 'Sweden': '瑞典',
  'Switzerland': '瑞士', 'Tunisia': '突尼斯', 'Türkiye': '土耳其', 'United States': '美國',
  'Uruguay': '烏拉圭', 'Uzbekistan': '烏茲別克斯坦',
};

const sortLabel = (w: Window) => ({ '1h': '1小時前', '4h': '4小時前', '24h': '24小時前' }[w]);

export default function WorldCupPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted ? theme === 'dark' : true;

  // Default to 4h because yesterday (06-30) had no matches, so chg_24h would
  // be null for every row and the table would be full of "—". 4h is the
  // sweet spot — odds typically have a 4h-ish narrative arc over a day.
  const [window, setWindow] = useState<Window>('4h');
  const [sortBy, setSortBy] = useState<'time' | 'change'>('time');
  // `nowMs` is impure (Date.now()) — call once on mount and refresh every 60s
  // so row visibility doesn't flicker as state changes re-render the page.
  // Pre-mount default (0) renders ALL rows; the useEffect ticks once on mount
  // and from then on the filter is stable. The pre-mount frame is invisible
  // to users — it's the first paint.
  const [nowMs, setNowMs] = useState<number>(0);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const bg = isDark ? 'dark bg-[#0f1117]' : 'bg-white';
  const text = isDark ? 'text-zinc-100' : 'text-zinc-900';
  const muted = isDark ? 'text-zinc-400' : 'text-zinc-500';
  const muted2 = isDark ? 'text-zinc-500' : 'text-zinc-400';
  const border = isDark ? 'border-zinc-700' : 'border-zinc-200';
  const hover = isDark ? 'hover:bg-zinc-800/60' : 'hover:bg-zinc-50';
  const thead = isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-100 border-zinc-200';
  const polyBg = isDark ? 'bg-zinc-800/30 border-zinc-700/40' : 'bg-zinc-50';
  const cardBg = isDark ? 'bg-zinc-800/50' : 'bg-zinc-100';

  const rows = [...data.matches].sort((a, b) => {
    if (sortBy === 'change') {
      const c = `chg_${window}` as 'chg_1h' | 'chg_4h' | 'chg_24h';
      return Math.abs(b[c]?.hkjc_home ?? 0) - Math.abs(a[c]?.hkjc_home ?? 0);
    }
    return (a.gameTime || '').localeCompare(b.gameTime || '');
  });

  // Hide matches that kicked off more than 3h ago — keeps closing odds visible
  // for recently-started games while clearing out yesterday's results.
  // `nowMs` is computed once on mount (see useEffect above) and refreshed
  // every 60s, so this filter is stable across re-renders.
  const HIDE_AFTER_MS = 3 * 60 * 60 * 1000; // 3 hours post-kickoff
  const visibleRows = rows.filter((m) => {
    if (!m.gameTime) return true; // no time → show
    const t = Date.parse(m.gameTime.replace(' ', 'T') + '+08:00'); // HKT
    if (isNaN(t)) return true;
    return nowMs === 0 || nowMs - t < HIDE_AFTER_MS;
  });

  const activeBtn = 'bg-sky-600 text-white shadow-sm';
  const inactiveBtn = isDark
    ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
    : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100';

  return (
    <div className={`min-h-screen ${bg} ${text} transition-colors`}>
      <div className="mx-auto max-w-5xl px-4 py-8">

        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight">🏆 世界盃賠率走勢</h1>
          <p className={`mt-2 text-sm ${muted}`}>
            更新 {data.latest_datetime?.replace('_', ' ')} HKT · 馬會 1x2 + Polymarket 概率 · 顯示 {visibleRows.length} / {rows.length} 場
          </p>
        </div>

        {/* Controls */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`text-sm ${muted}`}>比較：</span>
            <div className="inline-flex rounded-lg border border-border bg-card p-1 gap-1">
              {(['1h', '4h', '24h'] as Window[]).map(w => (
                <button
                  key={w}
                  onClick={() => setWindow(w)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${window === w ? activeBtn : inactiveBtn}`}
                >
                  {sortLabel(w)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm ${muted}`}>排序：</span>
            <button onClick={() => setSortBy('time')} className={`px-3 py-1.5 rounded-md text-sm transition-all ${sortBy === 'time' ? activeBtn : inactiveBtn}`}>⏰ 時間</button>
            <button onClick={() => setSortBy('change')} className={`px-3 py-1.5 rounded-md text-sm transition-all ${sortBy === 'change' ? activeBtn : inactiveBtn}`}>📈 變動</button>
          </div>
        </div>

        {/* Table */}
        <div className={`rounded-xl border ${border} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={`border-b ${thead}`}>
                <th className={`py-3 px-4 text-left font-medium ${muted}`}>賽事</th>
                <th className={`py-3 px-3 text-center font-medium ${muted}`}>主勝</th>
                <th className={`py-3 px-3 text-center font-medium ${muted}`}>和局</th>
                <th className={`py-3 px-3 text-center font-medium ${muted}`}>客勝</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr><td colSpan={4} className={`py-12 text-center ${muted}`}>今日沒有即將開賽的賽事 🎉</td></tr>
              ) : visibleRows.map((match, i) => {
                const chg = match[`chg_${window}` as keyof Match] as Changes | undefined;
                const h = match.hkjc;
                const p = match.poly;
                const dtCN = fmtDateCN(match.gameTime || '');

                return (
                  <tr key={`${i}`} className={`border-b ${border} ${hover} transition-colors`}>
                    {/* Match name + date */}
                    <td className="py-3 px-4">
                      <div className={`font-semibold text-sm ${text}`}>{TEAM_CN[match.homeTeam] || match.homeTeam} <span className={`${muted2}`}>vs</span> {TEAM_CN[match.awayTeam] || match.awayTeam}</div>
                      <div className={`text-xs ${muted2} mt-0.5`}>{dtCN}</div>
                    </td>

                    {/* Home / 主勝 */}
                    <td className="py-3 px-3 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-bold text-emerald-400 text-base">{fmt(h.home)}</span>
                        {chg && chg.hkjc_home != null && chg.hkjc_home !== 0 && (
                          <span className={`text-xs font-medium ${chgColor(chg.hkjc_home, true)}`}>
                            {arrow(chg.hkjc_home)}{Math.abs(chg.hkjc_home).toFixed(1)}%
                          </span>
                        )}
                        <span className="text-sky-400 text-sm font-medium">
                          {fmtPct(p.home)}
                          {chg && chg.poly_home != null && chg.poly_home !== 0 && (
                            <span className={`text-xs ml-0.5 ${chg.poly_home > 0 ? 'text-emerald-400' : chg.poly_home < 0 ? 'text-red-400' : muted2}`}>
                              {arrow(chg.poly_home)}{Math.abs(chg.poly_home).toFixed(1)}%
                            </span>
                          )}
                        </span>
                      </div>
                    </td>

                    {/* Draw / 和局 */}
                    <td className="py-3 px-3 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className={`font-bold text-base ${text}`}>{fmt(h.draw)}</span>
                        {chg && chg.hkjc_draw != null && chg.hkjc_draw !== 0 && (
                          <span className={`text-xs font-medium ${chgColor(chg.hkjc_draw, false)}`}>
                            {arrow(chg.hkjc_draw)}{Math.abs(chg.hkjc_draw).toFixed(1)}%
                          </span>
                        )}
                        <span className={`text-sm font-medium ${muted2}`}>
                          {fmtPct(p.draw)}
                          {chg && chg.poly_draw != null && chg.poly_draw !== 0 && (
                            <span className={`text-xs ml-0.5 ${chg.poly_draw > 0 ? 'text-emerald-400' : chg.poly_draw < 0 ? 'text-red-400' : muted2}`}>
                              {arrow(chg.poly_draw)}{Math.abs(chg.poly_draw).toFixed(1)}%
                            </span>
                          )}
                        </span>
                      </div>
                    </td>

                    {/* Away / 客勝 */}
                    <td className="py-3 px-3 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-bold text-red-400 text-base">{fmt(h.away)}</span>
                        {chg && chg.hkjc_away != null && chg.hkjc_away !== 0 && (
                          <span className={`text-xs font-medium ${chgColor(chg.hkjc_away, true)}`}>
                            {arrow(chg.hkjc_away)}{Math.abs(chg.hkjc_away).toFixed(1)}%
                          </span>
                        )}
                        <span className="text-orange-400 text-sm font-medium">
                          {fmtPct(p.away)}
                          {chg && chg.poly_away != null && chg.poly_away !== 0 && (
                            <span className={`text-xs ml-0.5 ${chg.poly_away > 0 ? 'text-emerald-400' : chg.poly_away < 0 ? 'text-red-400' : muted2}`}>
                              {arrow(chg.poly_away)}{Math.abs(chg.poly_away).toFixed(1)}%
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={`mt-6 rounded-xl border ${border} ${cardBg} p-4 text-xs ${muted}`}>
          <h4 className={`mb-2 font-medium ${text}`}>📖 說明</h4>
          <ul className="space-y-1">
            <li>🟢 <b>馬會賠率</b>：十進制賠率 (如 1.85 = 需投注 HK$1 贏 HK$0.85)</li>
            <li>🔵 <b>Polymarket</b>：隱含概率 % (如 55% = 該選項有 55% 機會)</li>
            <li>↑/↓ = 對比較時段升/跌</li>
          </ul>
        </div>

      </div>
    </div>
  );
}
