import { FlightDealCard } from '@/components/FlightDealCard';
import allDatesHkg from '@/data/all_dates.json';
import allDatesSzx from '@/data/all_dates_szx.json';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ dep?: string }>;
}

export default async function RoutePage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const { dep } = await searchParams;
  const departure = (dep === 'SZX' ? 'SZX' : 'HKG') as 'HKG' | 'SZX';
  const allData = departure === 'HKG' ? allDatesHkg : allDatesSzx;
  const deals = (allData.results || []) as any[];
  const deal = deals.find((d: any) => d.destination.code === code);

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="mx-auto max-w-lg px-4">
        {/* Back Link */}
        <Link
          href={`/?dep=${departure}`}
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          返回 {departure === 'HKG' ? '香港國際機場' : '深圳寶安機場'}
        </Link>

        {/* Departure Badge */}
        <div className="mb-4">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            departure === 'SZX'
              ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
              : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400'
          }`}>
            🛫 {departure === 'HKG' ? '香港國際機場 (HKG)' : '深圳寶安機場 (SZX)'}
          </span>
        </div>

        {/* Flight Deal Card */}
        {deal ? (
          <FlightDealCard deal={deal} departure={departure} />
        ) : (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <p className="text-muted-foreground">
              {departure === 'SZX' ? '深圳航班資料掃描中...' : `找不到 ${code} 的數據`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
