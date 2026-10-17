// Hermes 2026-10-17: Cantonese Traditional Chinese translation helpers
// for Google Flights digest data. The email body is in English (Google
// product email), so we translate dates, airline names, "stops", "hr"
// on the way out.
//
// Used by both the main page (page.tsx) and the deals page (deals/page.tsx).

const DOW_ZH: Record<string, string> = {
  Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六', Sun: '日',
};

const MONTH_ZH: Record<string, string> = {
  Jan: '1月', Feb: '2月', Mar: '3月', Apr: '4月',
  May: '5月', Jun: '6月', Jul: '7月', Aug: '8月',
  Sep: '9月', Oct: '10月', Nov: '11月', Dec: '12月',
};

const AIRLINE_ZH: Record<string, string> = {
  'Alaska': '阿拉斯加航空',
  'Cathay Pacific': '國泰航空',
  'Cathay Dragon': '國泰港龍',
  'China Airlines': '中華航空',
  'China Eastern': '中國東方航空',
  'China Southern': '中國南方航空',
  'Delta': '達美航空',
  'United': '聯合航空',
  'American': '美國航空',
  'Air Canada': '加拿大航空',
  'Japan Airlines': '日本航空',
  'ANA': '全日空',
  'Korean Air': '大韓航空',
  'Asiana': '韓亞航空',
  'Singapore Airlines': '新加坡航空',
  'Emirates': '阿聯酋航空',
  'Qatar': '卡塔爾航空',
  'Lufthansa': '漢莎航空',
  'British Airways': '英國航空',
  'Air France': '法國航空',
  'KLM': '荷蘭皇家航空',
  'Qantas': '澳洲航空',
  'Hainan Airlines': '海南航空',
  'Xiamen Airlines': '廈門航空',
  'EVA Air': '長榮航空',
  'AirAsia': '亞洲航空',
  'Scoot': '酷航',
  'Thai Airways': '泰國航空',
  'Vietnam Airlines': '越南航空',
  'Philippine Airlines': '菲律賓航空',
  'Cebu Pacific': '宿霧太平洋航空',
};

const CITY_ZH: Record<string, string> = {
  'Hong Kong': '香港',
  'Las Vegas': '拉斯維加斯',
  'Fort Lauderdale': '羅德岱堡',
  'Taipei City': '台北',
  'Fukuoka': '福岡',
  'Istanbul': '伊斯坦堡',
  'Paris': '巴黎',
  'Seattle': '西雅圖',
  'Athens': '雅典',
  'San Francisco': '三藩市',
  'Cape Town': '開普敦',
  'Tokyo': '東京',
  'Dublin': '都柏林',
  'Dubai': '杜拜',
  'Lisbon': '里斯本',
  'Madrid': '馬德里',
  'Barcelona': '巴塞隆拿',
  'Chicago': '芝加哥',
  'Newark': '紐瓦克',
  'Zurich': '蘇黎世',
  'Rome': '羅馬',
  'Boston': '波士頓',
  'San Diego': '聖地牙哥',
  'Amsterdam': '阿姆斯特丹',
  'Vancouver': '溫哥華',
  'Bangkok': '曼谷',
  'London': '倫敦',
  'Singapore': '新加坡',
  'Edinburgh': '愛丁堡',
  'Milan': '米蘭',
  'Vienna': '維也納',
  'Prague': '布拉格',
  'Berlin': '柏林',
  'Munich': '慕尼黑',
  'Stockholm': '斯德哥爾摩',
  'Oslo': '奧斯陸',
  'Helsinki': '赫爾辛基',
  'Copenhagen': '哥本哈根',
  'Reykjavik': '雷克雅維克',
  'Cairo': '開羅',
  'Bali': '峇里',
  'Manila': '馬尼拉',
  'Seoul': '首爾',
  'Beijing': '北京',
  'Shanghai': '上海',
  'Mumbai': '孟買',
  'Delhi': '新德里',
  'Sydney': '悉尼',
  'Melbourne': '墨爾本',
  'Auckland': '奧克蘭',
  'Toronto': '多倫多',
  'Montreal': '滿地可',
  'Mexico City': '墨西哥城',
  'Hawaii': '夏威夷',
};

export function translateDateRange(dr: string): string {
  // "Thu, Jan 28 – Thu, Feb 4" → "1月28日(四) - 2月4日(四)"
  const m = dr.match(
    /^([A-Z][a-z]{2}),\s+([A-Z][a-z]{2})\s+(\d+)\s*[–\-]\s*([A-Z][a-z]{2}),\s+([A-Z][a-z]{2})\s+(\d+)$/,
  );
  if (!m) return dr;
  const [, dow1, mon1, day1, dow2, mon2, day2] = m;
  return `${MONTH_ZH[mon1] || mon1}${day1}日(${DOW_ZH[dow1] || dow1}) - ${MONTH_ZH[mon2] || mon2}${day2}日(${DOW_ZH[dow2] || dow2})`;
}

export function translateAirlines(airlines: string | null): string | null {
  if (!airlines) return airlines;
  return airlines.split(',').map((p) => AIRLINE_ZH[p.trim()] || p.trim()).join(', ');
}

export function translateCity(city: string): string {
  return CITY_ZH[city] || city;
}

export function translateStops(n: number | null): string {
  if (n == null) return '';
  return n === 0 ? '直航' : `轉機 ${n} 次`;
}

export function translateDuration(d: string | null): string {
  if (!d) return '';
  return d.replace(/^(\d+)hr$/, '$1小時');
}
