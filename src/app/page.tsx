import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import realDeals from '@/data/real-deals.json';

const regionColors: Record<string, string> = {
  '東南亞': 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  '東亞': 'bg-sky-500/10 text-sky-600 border-sky-500/30',
  '中國': 'bg-red-500/10 text-red-600 border-red-500/30',
  '大洋洲': 'bg-cyan-500/10 text-cyan-600 border-cyan-500/30',
  '北美洲': 'bg-red-500/10 text-red-600 border-red-500/30',
  '歐洲': 'bg-violet-500/10 text-violet-600 border-violet-500/30',
  '南亞': 'bg-orange-500/10 text-orange-600 border-orange-500/30',
  '中東': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  '非洲': 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  '香港': 'bg-pink-500/10 text-pink-600 border-pink-500/30',
};

export default function Home() {
  const deals = realDeals as any[];

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
            <div className="text-2xl font-bold text-emerald-600">{deals.length}</div>
            <div className="text-xs text-muted-foreground">個目的地</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-emerald-600">$758</div>
            <div className="text-xs text-muted-foreground">最低價</div>
          </div>
        </div>

        {/* Destinations Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {deals.map((dest) => (
            <Link key={dest.route} href={`/route/${dest.destination.code}`} className="group">
              <Card className="transition-all duration-200 hover:border-sky-500/50 hover:shadow-lg hover:shadow-sky-500/10">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-xl">{dest.destination.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">{dest.destination.code}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-emerald-600">${dest.price.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">起</div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <Badge
                      variant="outline"
                      className={`${regionColors[dest.destination.region] || 'bg-slate-500/10 text-slate-600 border-slate-500/30'}`}
                    >
                      {dest.destination.region}
                    </Badge>
                    <span className="text-sm text-sky-600 transition-colors group-hover:text-sky-500">
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
