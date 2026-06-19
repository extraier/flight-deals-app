import Link from 'next/link';

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

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0f141c] py-8">
      <div className="mx-auto max-w-4xl px-4">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-[#e2e8f0]">CompareTiger</h1>
          <p className="mt-2 text-[#708090]">香港國際機場 ✈️ 最低機票</p>
        </div>

        {/* Destinations Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {destinations.map((dest) => (
            <Link
              key={dest.code}
              href={`/route/${dest.code}`}
              className="block rounded-2xl border border-[#202c3d] bg-[#16202c] p-4 transition-colors hover:border-[#3da8f5]/50"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-[#e2e8f0]">{dest.name}</h2>
                  <p className="text-xs text-[#708090]">
                    {dest.region} · {dest.code}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold text-[#00e676]">{dest.price}</span>
                  <span className="ml-1 text-xs text-[#e2e8f0]">起</span>
                </div>
              </div>
              <div className="mt-3 text-center">
                <span className="text-sm text-[#3da8f5]">查看平價日子 →</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
