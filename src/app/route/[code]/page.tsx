import { FlightDealCard } from '@/components/FlightDealCard';
import { sampleDeals } from '@/data/sample-deals';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ code: string }>;
}

export default async function RoutePage({ params }: PageProps) {
  const { code } = await params;
  const deal = sampleDeals.find((d) => d.destination.code === code);

  return (
    <div className="min-h-screen bg-[#0f141c] py-8">
      <div className="mx-auto max-w-md px-4">
        {/* Back Link */}
        <Link href="/" className="mb-6 inline-flex items-center text-sm text-[#3da8f5] hover:underline">
          ← 返回目錄
        </Link>

        {/* Flight Deal Card */}
        {deal ? (
          <FlightDealCard deal={deal} />
        ) : (
          <div className="rounded-2xl border border-[#202c3d] bg-[#16202c] p-8 text-center">
            <p className="text-[#708090]">找不到 {code} 的數據</p>
          </div>
        )}
      </div>
    </div>
  );
}
