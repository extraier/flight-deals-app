import { FlightDealCard } from '@/components/FlightDealCard';
import { sampleDeals } from '@/data/sample-deals';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface PageProps {
  params: Promise<{ code: string }>;
}

export default async function RoutePage({ params }: PageProps) {
  const { code } = await params;
  const deal = sampleDeals.find((d) => d.destination.code === code);

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="mx-auto max-w-lg px-4">
        {/* Back Link */}
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          返回目錄
        </Link>

        {/* Flight Deal Card */}
        {deal ? (
          <FlightDealCard deal={deal} />
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-card p-8 text-center">
            <p className="text-muted-foreground">找不到 {code} 的數據</p>
          </div>
        )}
      </div>
    </div>
  );
}
