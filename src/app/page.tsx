import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const destinations = [
  { code: 'MNL', name: '馬尼拉', region: '東南亞', price: '$1,003' },
  { code: 'BKK', name: '曼谷', region: '東南亞', price: '$892' },
  { code: 'TPE', name: '台北', region: '東亞', price: '$758' },
  { code: 'TYO', name: '東京', region: '東亞', price: '$1,245' },
  { code: 'OSA', name: '大阪', region: '東亞', price: '$1,189' },
  { code: 'ICN', name: '首爾', region: '東亞', price: '$892' },
  { code: 'SIN', name: '新加坡', region: '東南亞', price: '$1,045' },
  { code: 'KUL', name: '吉隆坡', region: '東南亞', price: '$823' },
  { code: 'SYD', name: '悉尼', region: '大洋洲', price: '$2,890' },
  { code: 'LAX', name: '洛杉矶', region: '北美洲', price: '$5,234' },
  { code: 'LHR', name: '倫敦', region: '歐洲', price: '$4,512' },
  { code: 'CDG', name: '巴黎', region: '歐洲', price: '$4,678' },
];

const regionColors: Record<string, string> = {
  '東南亞': 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  '東亞': 'bg-sky-500/10 text-sky-400 border-sky-500/30',
  '大洋洲': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  '北美洲': 'bg-red-500/10 text-red-400 border-red-500/30',
  '歐洲': 'bg-violet-500/10 text-violet-400 border-violet-500/30',
};

export default function Home() {
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="mx-auto max-w-5xl px-4">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">CompareTiger</h1>
          <p className="mt-3 text-lg text-muted-foreground">香港國際機場 ✈️ 最低機票</p>
        </div>

        {/* Stats */}
        <div className="mb-8 flex justify-center gap-8">
          <div className="text-center">
            <div className="text-2xl font-bold text-emerald-400">57</div>
            <div className="text-xs text-muted-foreground">個目的地</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-emerald-400">24/7</div>
            <div className="text-xs text-muted-foreground">實時更新</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-emerald-400">$758</div>
            <div className="text-xs text-muted-foreground">最低價</div>
          </div>
        </div>

        {/* Destinations Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {destinations.map((dest) => (
            <Link key={dest.code} href={`/route/${dest.code}`} className="group">
              <Card className="transition-all duration-200 hover:border-sky-500/50 hover:shadow-lg hover:shadow-sky-500/10">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-xl">{dest.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">{dest.code}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-emerald-400">{dest.price}</div>
                      <div className="text-xs text-muted-foreground">起</div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <Badge
                      variant="outline"
                      className={`${regionColors[dest.region] || 'bg-slate-500/10 text-slate-400 border-slate-500/30'}`}
                    >
                      {dest.region}
                    </Badge>
                    <span className="text-sm text-sky-400 transition-colors group-hover:text-sky-300">
                      查看詳情 →
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
