import fs from 'fs';

const CITY_NAMES = {
  AKL: { name: '奧克蘭', region: '大洋洲' },
  AMS: { name: '阿姆斯特丹', region: '歐洲' },
  BKK: { name: '曼谷', region: '東南亞' },
  BCN: { name: '巴塞羅那', region: '歐洲' },
  BOM: { name: '孟買', region: '南亞' },
  CAN: { name: '廣州', region: '中國' },
  CAI: { name: '開羅', region: '中東' },
  CDG: { name: '巴黎', region: '歐洲' },
  CGK: { name: '雅加達', region: '東南亞' },
  CMB: { name: '科倫坡', region: '南亞' },
  CTS: { name: '札幌', region: '東亞' },
  CTU: { name: '成都', region: '中國' },
  DEL: { name: '德里', region: '南亞' },
  DOH: { name: '多哈', region: '中東' },
  DPS: { name: '峇里島', region: '東南亞' },
  DXB: { name: '杜拜', region: '中東' },
  FCO: { name: '羅馬', region: '歐洲' },
  FRA: { name: '法蘭克福', region: '歐洲' },
  FUK: { name: '福岡', region: '東亞' },
  HAN: { name: '河內', region: '東南亞' },
  HKG: { name: '香港', region: '香港' },
  HKT: { name: '布吉', region: '東南亞' },
  ICN: { name: '首爾', region: '東亞' },
  JNB: { name: '約翰內斯堡', region: '非洲' },
  JFK: { name: '紐約', region: '北美洲' },
  KHH: { name: '高雄', region: '東亞' },
  KIX: { name: '大阪', region: '東亞' },
  KUL: { name: '吉隆坡', region: '東南亞' },
  LAX: { name: '洛杉矶', region: '北美洲' },
  LHR: { name: '倫敦', region: '歐洲' },
  MAD: { name: '馬德里', region: '歐洲' },
  MEL: { name: '墨爾本', region: '大洋洲' },
  MNL: { name: '馬尼拉', region: '東南亞' },
  NGO: { name: '名古屋', region: '東亞' },
  NRT: { name: '東京', region: '東亞' },
  OKA: { name: '沖繩', region: '東亞' },
  ORD: { name: '芝加哥', region: '北美洲' },
  PEK: { name: '北京', region: '中國' },
  PEN: { name: '檳城', region: '東南亞' },
  PUS: { name: '釜山', region: '東亞' },
  PVG: { name: '上海', region: '中國' },
  RGN: { name: '仰光', region: '東南亞' },
  RMQ: { name: '台中', region: '東亞' },
  SEA: { name: '西雅圖', region: '北美洲' },
  SFO: { name: '三藩市', region: '北美洲' },
  SIN: { name: '新加坡', region: '東南亞' },
  SGN: { name: '胡志明市', region: '東南亞' },
  SYD: { name: '悉尼', region: '大洋洲' },
  SZX: { name: '深圳', region: '中國' },
  TPE: { name: '台北', region: '東亞' },
  XIY: { name: '西安', region: '中國' },
  YVR: { name: '溫哥華', region: '北美洲' },
};

async function fetchData() {
  // Read from local file downloaded from NAS
  const data = JSON.parse(fs.readFileSync('/tmp/run_latest.json', 'utf-8'));

  const deals = data.results.map((r) => {
    const destCode = r.route.split('→')[1];
    const cityInfo = CITY_NAMES[destCode] || { name: destCode, region: '其他' };

    // Parse dates from the 'dates' object
    const dates = Object.entries(r.dates || {}).map(([dateStr, price]) => {
      const d = new Date(dateStr);
      return {
        day: d.getDate(),
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        price: price,
      };
    });

    // Get typical price from best if available
    const typicalPrice = r.best?.typical_avg || 0;

    return {
      route: r.route,
      destination: {
        name: cityInfo.name,
        code: destCode,
        region: cityInfo.region,
      },
      price: r.best?.price || Object.values(r.dates || {})[0] || 0,
      currency: 'HKD',
      badge: {
        carryOn: true,
        cheapDays: dates.length,
      },
      typicalPrice: typicalPrice,
      cheapestDates: dates,
      totalDestinations: data.results.length,
    };
  });

  // Sort by price
  deals.sort((a, b) => a.price - b.price);

  // Write to JSON file that Next.js can import
  fs.writeFileSync('./src/data/real-deals.json', JSON.stringify(deals, null, 2));

  console.log(`Generated ${deals.length} deals`);
  console.log('Cheapest routes:');
  deals.slice(0, 5).forEach((d) => {
    console.log(`  ${d.destination.name} (${d.code}): $${d.price} - ${d.cheapestDates.length} dates`);
  });
}

fetchData().catch(console.error);
