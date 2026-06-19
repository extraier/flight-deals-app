import { FlightDealCard } from '@/components/FlightDealCard';
import { sampleDeals } from '@/data/sample-deals';

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0f141c] py-8">
      <div className="mx-auto max-w-4xl px-4">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-[#e2e8f0]">CompareTiger</h1>
          <p className="mt-2 text-[#708090]">香港國際機場 ✈️ 最低機票</p>
        </div>

        {/* Flight Deals Grid */}
        <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2">
          {sampleDeals.map((deal) => (
            <FlightDealCard key={deal.route} deal={deal} />
          ))}
        </div>
      </div>
    </div>
  );
}
