/**
 * Extreme open-jaw (開口機票) fares from the ITA Matrix daily report.
 *
 * A card is shown only when the package (ITA fare + positioning flight) is
 * more than 70% below the Hong Kong direct baseline. The scanner's own
 * flag (about 10% / HK$500) is ignored.
 *
 * User-facing city strings are bare Chinese names. IATA codes are never
 * returned on a card.
 */

export const EXTREME_SAVING_PCT = 70;

export interface OpenJawCard {
  id: string;
  title: string;
  originCity: string;
  destinationCity: string;
  dateLabel: string;
  positioningSummary: string | null;
  packagePrice: number;
  directPrice: number;
  /** Unrounded. A card is visible only when this is greater than 70. */
  savingPct: number;
  savingHkd: number;
}

export interface OpenJawReportView {
  date: string | null;
  searchedAt: string | null;
  currency: string;
  scanned: number;
  deals: OpenJawCard[];
}

const CJK = /[\u3400-\u9fff]/;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Airport / city code → bare Traditional Chinese name. Codes never reach the UI. */
const CITY_BY_CODE: Record<string, string> = {
  HKG: '香港', SZX: '深圳',
  AKL: '奧克蘭', AMS: '阿姆斯特丹', ATH: '雅典', BCN: '巴塞隆拿', BER: '柏林',
  BKI: '亞庇', BKK: '曼谷', BGY: '貝加莫', BOM: '孟買', BRU: '布魯塞爾',
  BUD: '布達佩斯', CAI: '開羅', CAN: '廣州', CDG: '巴黎', CGK: '雅加達',
  CIA: '羅馬', CJU: '濟州', CMB: '科倫坡', CNX: '清邁', CPH: '哥本哈根',
  CRK: '克拉克', CTS: '札幌', CTU: '成都', CZX: '長沙', DAD: '峴港',
  DEL: '德里', DOH: '多哈', DPS: '峇里島', DUB: '都柏林', DXB: '杜拜',
  EIN: '埃因霍溫', FCO: '羅馬', FRA: '法蘭克福', FUK: '福岡', GVA: '日內瓦',
  HAM: '漢堡', HAN: '河內', HEL: '赫爾辛基', HIJ: '廣島', HKT: '布吉',
  HND: '東京', ICN: '首爾', ISG: '石垣', IST: '伊斯坦堡', JFK: '紐約',
  JNB: '約翰內斯堡', KEF: '雷克雅維克', KHH: '高雄', KIX: '大阪', KMQ: '小松',
  KUL: '吉隆坡', LAX: '洛杉磯', LGW: '倫敦', LHR: '倫敦', LIN: '米蘭',
  LIS: '里斯本', MAD: '馬德里', MAN: '曼徹斯特', MEL: '墨爾本', MNL: '馬尼拉',
  MUC: '慕尼黑', MXP: '米蘭', NCE: '尼斯', NGB: '寧波', NGO: '名古屋',
  NOS: '諾西貝', NRT: '東京', OKA: '沖繩', OKE: '沖繩', OPO: '波爾圖',
  ORD: '芝加哥', ORY: '巴黎', OSL: '奧斯陸', PEK: '北京', PEN: '檳城',
  PKX: '北京', PMI: '馬略卡', PQC: '富國島', PRG: '布拉格', PUS: '釜山',
  PVG: '上海', RGN: '仰光', RMQ: '台中', ARN: '斯德哥爾摩', SAW: '伊斯坦堡',
  SDJ: '仙台', SEA: '西雅圖', SFO: '三藩市', SGN: '胡志明市', SIN: '新加坡',
  STN: '倫敦', SYD: '悉尼', SYX: '三亞', SZB: '吉隆坡', TAE: '大邱',
  TAK: '高松', TPE: '台北', VIE: '維也納', WAW: '華沙', WUX: '無錫',
  XIY: '西安', YIW: '義烏', YVR: '溫哥華', ZRH: '蘇黎世',
};

const CITY_BY_ENGLISH: Record<string, string> = {
  'hong kong': '香港',
  shenzhen: '深圳',
  paris: '巴黎',
  london: '倫敦',
  tokyo: '東京',
  osaka: '大阪',
  seoul: '首爾',
  taipei: '台北',
  bangkok: '曼谷',
  singapore: '新加坡',
  'kuala lumpur': '吉隆坡',
  lisbon: '里斯本',
  rome: '羅馬',
  milan: '米蘭',
  barcelona: '巴塞隆拿',
  madrid: '馬德里',
  amsterdam: '阿姆斯特丹',
  berlin: '柏林',
  munich: '慕尼黑',
  zurich: '蘇黎世',
  geneva: '日內瓦',
  vienna: '維也納',
  prague: '布拉格',
  dublin: '都柏林',
  dubai: '杜拜',
  doha: '多哈',
  sydney: '悉尼',
  melbourne: '墨爾本',
  auckland: '奧克蘭',
  'new york': '紐約',
  'los angeles': '洛杉磯',
  'san francisco': '三藩市',
  chicago: '芝加哥',
  seattle: '西雅圖',
  vancouver: '溫哥華',
  frankfurt: '法蘭克福',
  istanbul: '伊斯坦堡',
  athens: '雅典',
  copenhagen: '哥本哈根',
  stockholm: '斯德哥爾摩',
  oslo: '奧斯陸',
  helsinki: '赫爾辛基',
  reykjavik: '雷克雅維克',
  cairo: '開羅',
  mumbai: '孟買',
  delhi: '德里',
  beijing: '北京',
  shanghai: '上海',
  manila: '馬尼拉',
};

const AIRLINE_ZH: Record<string, string> = {
  CX: '國泰', KA: '國泰港龍', UO: '香港快運', HX: '香港航空',
  NH: '全日空', JL: '日本航空', MM: '樂桃', GK: '捷星日本',
  KE: '大韓航空', OZ: '韓亞航空', BX: '釜山航空',
  CI: '中華航空', BR: '長榮航空', TR: '酷航', SQ: '新加坡航空',
  AK: '亞洲航空', D7: '亞洲航空', VJ: '越捷航空', PR: '菲律賓航空',
  '5J': '宿霧太平洋', TG: '泰國航空', MH: '馬來西亞航空',
  CA: '中國國航', MU: '中國東方航空', CZ: '中國南方航空',
  HU: '海南航空', FM: '上海航空', SC: '山東航空',
  EK: '阿聯酋航空', EY: '阿提哈德航空', QR: '卡塔爾航空', TK: '土耳其航空',
  BA: '英國航空', AF: '法國航空', KL: '荷蘭皇家航空', LH: '漢莎航空',
  LX: '瑞士航空', QF: '澳洲航空', UA: '聯合航空', AC: '加拿大航空',
  AA: '美國航空', DL: '達美航空', AY: '芬蘭航空', SK: '北歐航空',
  'cathay pacific': '國泰', 'cathay dragon': '國泰港龍',
  'hong kong express': '香港快運', 'hk express': '香港快運',
  ana: '全日空', 'japan airlines': '日本航空',
  'korean air': '大韓航空', asiana: '韓亞航空',
  'china airlines': '中華航空', 'eva air': '長榮航空',
  scoot: '酷航', 'singapore airlines': '新加坡航空',
  airasia: '亞洲航空', 'thai airways': '泰國航空',
  emirates: '阿聯酋航空', qatar: '卡塔爾航空', 'qatar airways': '卡塔爾航空',
  lufthansa: '漢莎航空', 'british airways': '英國航空',
  'air france': '法國航空', klm: '荷蘭皇家航空',
  qantas: '澳洲航空', united: '聯合航空', 'air canada': '加拿大航空',
  american: '美國航空', delta: '達美航空',
};

export function isExtremeOpenJawSaving(pct: number): boolean {
  return Number.isFinite(pct) && pct > EXTREME_SAVING_PCT;
}

export function formatSavingPct(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Cards the page is allowed to render. 70% exactly, and anything lower, is dropped. */
export function visibleOpenJawCards(deals: readonly OpenJawCard[]): OpenJawCard[] {
  return deals.filter((d) => isExtremeOpenJawSaving(d.savingPct));
}

export function hasIataLeak(text: string): boolean {
  const withoutMoney = text.replace(/HK\$[\d,]+/g, '');
  return /[A-Z]{2,3}/.test(withoutMoney);
}

export function selectExtremeOpenJawDeals(report: unknown): OpenJawReportView {
  const root = asRecord(report);
  const rows = root && Array.isArray(root.rows) ? root.rows : [];
  const deals: OpenJawCard[] = [];

  for (const row of rows) {
    const card = cardFromRow(row);
    if (card && isExtremeOpenJawSaving(card.savingPct)) deals.push(card);
  }

  deals.sort((a, b) => b.savingPct - a.savingPct || a.packagePrice - b.packagePrice);

  return {
    date: root && typeof root.date === 'string' ? root.date : null,
    searchedAt: root
      ? (typeof root.searchedAt === 'string'
        ? root.searchedAt
        : typeof root.searched_at === 'string'
          ? root.searched_at
          : null)
      : null,
    currency: root && typeof root.currency === 'string' ? root.currency : 'HKD',
    scanned: rows.length,
    deals,
  };
}

function cardFromRow(row: unknown): OpenJawCard | null {
  const rec = asRecord(row);
  if (!rec) return null;

  const legs = collectPositioning(rec);
  const ita = itaPrice(rec);
  const posPrices = legs
    .map((leg) => leg.price)
    .filter((n): n is number => n != null);
  const posSum = posPrices.length > 0 ? posPrices.reduce((sum, n) => sum + n, 0) : null;
  const stated = num(rec.package_total ?? rec.packageTotal);
  const packagePrice = ita != null && posSum != null ? ita + posSum : stated;
  const directPrice = baselinePrice(rec);
  if (packagePrice == null || directPrice == null || directPrice <= 0) return null;

  const savingPct = ((directPrice - packagePrice) / directPrice) * 100;
  if (!isExtremeOpenJawSaving(savingPct)) return null;

  const itaRec = asRecord(rec.ita);
  const fromCity = pickCity(legs.map((leg) => leg.from));
  const toCity = pickCity(legs.map((leg) => leg.to));
  // The matrix fare starts where the positioning flight lands (HKG/SZX → that
  // city). A row-level "origin" of 香港/深圳 is the home airport, not the fare.
  const namedOrigin = pickCity([
    rec.origin_city,
    rec.origin_name,
    rec.origin_zh,
    rec.ita_origin_name,
    itaRec?.origin_city,
    itaRec?.origin_name,
    itaRec?.origin,
    itaRec?.from,
    rec.origin,
    rec.from,
  ]);
  const originCity = (toCity && toCity !== fromCity)
    ? toCity
    : (namedOrigin && namedOrigin !== fromCity)
      ? namedOrigin
      : (toCity || namedOrigin || '未知城市');

  const destinationCity = pickCity([
    rec.destination_city,
    rec.dest_city,
    rec.destination_name,
    rec.dest_name,
    rec.destination_zh,
    itaRec?.destination_city,
    itaRec?.destination_name,
    itaRec?.destination,
    itaRec?.to,
    rec.destination,
    rec.dest,
    rec.to,
  ]) || '未知城市';

  const { depart, ret } = pickDates(rec, itaRec, legs);
  const dateLabel = scrub(formatRange(depart, ret));

  const airline = airlineName(legs.map((leg) => leg.airline));
  const posDate = formatShortDate(firstNormalized(legs.map((leg) => leg.date)));
  const positioningSummary = scrub(buildPositioningSummary({
    fromCity,
    toCity: toCity || (originCity !== '未知城市' ? originCity : ''),
    airline,
    dateLabel: posDate,
    price: posSum,
  }));

  const title = scrub(`${originCity} → ${destinationCity}`);
  const savingHkd = Math.round(directPrice - packagePrice);

  return {
    id: [originCity, destinationCity, depart, ret, Math.round(packagePrice), Math.round(directPrice)].join('|'),
    title,
    originCity,
    destinationCity,
    dateLabel,
    positioningSummary,
    packagePrice,
    directPrice,
    savingPct,
    savingHkd,
  };
}

function buildPositioningSummary(parts: {
  fromCity: string;
  toCity: string;
  airline: string;
  dateLabel: string;
  price: number | null;
}): string | null {
  const route = parts.fromCity && parts.toCity
    ? `${parts.fromCity} → ${parts.toCity}`
    : parts.toCity
      ? `飛往${parts.toCity}`
      : parts.fromCity
        ? `由${parts.fromCity}出發`
        : '';
  const bits = [
    route,
    parts.airline,
    parts.dateLabel,
    parts.price != null ? `HK$${Math.round(parts.price).toLocaleString('en-HK')}` : '',
  ].filter(Boolean);
  if (bits.length === 0) return null;
  return `定位：${bits.join(' · ')}`;
}

function collectPositioning(row: Record<string, unknown>): Array<{
  price: number | null;
  from: unknown;
  to: unknown;
  airline: unknown;
  date: unknown;
}> {
  const raw = row.positioning ?? row.positioning_flight;
  const items = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const legs: Array<{
    price: number | null;
    from: unknown;
    to: unknown;
    airline: unknown;
    date: unknown;
  }> = [];
  for (const item of items) {
    const rec = asRecord(item);
    if (!rec) continue;
    const outbound = asRecord(rec.outbound);
    const src: Record<string, unknown> = outbound ? { ...rec, ...outbound } : rec;
    legs.push({
      price: num(src.price ?? src.total ?? src.fare),
      from: src.from ?? src.origin ?? src.departure ?? src.from_city ?? src.depart_from,
      to: src.to ?? src.destination ?? src.arrival ?? src.to_city ?? src.dest,
      airline: src.airline ?? src.carrier ?? src.airlines,
      date: src.date ?? src.depart_date ?? src.departure_date ?? src.outbound_date,
    });
  }
  return legs;
}

function itaPrice(row: Record<string, unknown>): number | null {
  const ita = asRecord(row.ita);
  if (ita) return num(ita.price ?? ita.total ?? ita.fare);
  return num(row.ita_price);
}

function baselinePrice(row: Record<string, unknown>): number | null {
  const raw = row.hkg_direct_baseline ?? row.hkgDirectBaseline;
  if (typeof raw === 'number' || typeof raw === 'string') return num(raw);
  const rec = asRecord(raw);
  if (!rec) return null;
  return num(rec.price ?? rec.total ?? rec.fare);
}

function pickCity(candidates: unknown[]): string {
  for (const candidate of candidates) {
    const name = bareCityName(candidate);
    if (name) return name;
  }
  return '';
}

export function bareCityName(input: unknown): string {
  if (typeof input === 'string') return resolveCityString(input);
  const rec = asRecord(input);
  if (!rec) return '';
  for (const key of ['name_zh', 'city_zh', 'name', 'city', 'label', 'zh']) {
    if (typeof rec[key] === 'string') {
      const name = resolveCityString(rec[key]);
      if (name) return name;
    }
  }
  for (const key of ['code', 'iata', 'airport', 'iata_code']) {
    if (typeof rec[key] === 'string') {
      const name = resolveCityString(rec[key]);
      if (name) return name;
    }
  }
  return '';
}

function resolveCityString(raw: string): string {
  const text = raw.trim();
  if (!text) return '';

  const paren = text.match(/^(.*?)[(（]\s*([A-Za-z]{2,3})\s*[)）]\s*$/);
  if (paren) {
    const left = paren[1].trim();
    const cjk = cjkName(left);
    if (cjk) return cjk;
    const english = CITY_BY_ENGLISH[left.toLowerCase()];
    if (english) return english;
    return CITY_BY_CODE[paren[2].toUpperCase()] || '';
  }

  const cjk = cjkName(text);
  if (cjk) return cjk;

  const english = CITY_BY_ENGLISH[text.toLowerCase()];
  if (english) return english;

  if (/^[A-Za-z]{3}$/.test(text)) return CITY_BY_CODE[text.toUpperCase()] || '';
  return '';
}

function cjkName(text: string): string {
  if (!CJK.test(text)) return '';
  return (text.match(/[\u3400-\u9fff]+/g) || []).join('');
}

function airlineName(values: unknown[]): string {
  for (const value of values) {
    const name = oneAirline(value);
    if (name) return name;
  }
  return '';
}

function oneAirline(value: unknown): string {
  if (Array.isArray(value)) {
    const names = value.map(oneAirline).filter(Boolean);
    return [...new Set(names)].join('、');
  }
  const rec = asRecord(value);
  if (rec) return oneAirline(rec.name_zh ?? rec.name ?? rec.airline ?? rec.code);
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text) return '';
  if (CJK.test(text)) return text.replace(/[（(]\s*[A-Za-z0-9]{2,3}\s*[)）]/g, '').trim();
  return AIRLINE_ZH[text] || AIRLINE_ZH[text.toUpperCase()] || AIRLINE_ZH[text.toLowerCase()] || '';
}

function pickDates(
  row: Record<string, unknown>,
  ita: Record<string, unknown> | null,
  legs: Array<{ date: unknown }>,
): { depart: string; ret: string } {
  const dates = asRecord(row.dates);
  const window = asRecord(row.window) || asRecord(row.travel_window);
  let depart = firstNormalized([
    row.depart_date, row.departure_date, row.outbound_date, row.date_out, row.start_date, row.out_date,
    dates?.depart, dates?.departure, dates?.outbound, dates?.start, dates?.from,
    window?.start, window?.from, window?.depart,
    ita?.depart_date, ita?.departure_date, ita?.outbound_date, ita?.depart, ita?.date,
    legs[0]?.date,
  ]);
  let ret = firstNormalized([
    row.return_date, row.inbound_date, row.date_in, row.end_date, row.in_date, row.ret_date,
    dates?.return, dates?.inbound, dates?.end, dates?.to,
    window?.end, window?.to, window?.return,
    ita?.return_date, ita?.inbound_date, ita?.return,
  ]);

  if (!depart || !ret) {
    const range = [row.date_range, typeof row.dates === 'string' ? row.dates : null, ita?.date_range]
      .find((v): v is string => typeof v === 'string' && v.trim() !== '');
    const parsed = range ? parseRange(range) : null;
    if (parsed) {
      depart = depart || parsed.depart;
      ret = ret || parsed.ret;
    }
  }

  if (!depart || !ret) {
    for (const value of [row.dates, row.window, row.travel_dates, ita?.dates]) {
      if (!Array.isArray(value) || value.length < 2) continue;
      const a = normalizeDate(value[0]);
      const b = normalizeDate(value[1]);
      if (a && b) {
        depart = depart || a;
        ret = ret || b;
        break;
      }
    }
  }

  return { depart, ret };
}

function firstNormalized(values: unknown[]): string {
  for (const value of values) {
    const iso = normalizeDate(value);
    if (iso) return iso;
  }
  return '';
}

function normalizeDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value !== 'string') return '';
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (dmy) {
    const month = MONTHS[dmy[2].slice(0, 3).toLowerCase()];
    if (month) return isoDate(Number(dmy[3]), month, Number(dmy[1]));
  }
  const mdy = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mdy) {
    const month = MONTHS[mdy[1].slice(0, 3).toLowerCase()];
    if (month) return isoDate(Number(mdy[3]), month, Number(mdy[2]));
  }
  return '';
}

function parseRange(text: string): { depart: string; ret: string } | null {
  const sameMonth = text.trim().match(/^(\d{1,2})\s*[–—\-]\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (sameMonth) {
    const month = MONTHS[sameMonth[3].slice(0, 3).toLowerCase()];
    if (!month) return null;
    const depart = isoDate(Number(sameMonth[4]), month, Number(sameMonth[1]));
    const ret = isoDate(Number(sameMonth[4]), month, Number(sameMonth[2]));
    return depart && ret ? { depart, ret } : null;
  }

  const parts = text.split(/\s*[–—/]| - | to /i).map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  let depart = normalizeDate(parts[0]);
  let ret = normalizeDate(parts[1]);
  const year = (parts[0].match(/\d{4}/) || parts[1].match(/\d{4}/) || [])[0];
  if (!depart && year) depart = normalizeDate(`${parts[0]} ${year}`);
  if (!ret && year) ret = normalizeDate(`${parts[1]} ${year}`);
  return depart && ret ? { depart, ret } : null;
}

function isoDate(year: number, month: number, day: number): string {
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatRange(depart: string, ret: string): string {
  const a = depart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const b = ret.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (a && b) {
    const ay = Number(a[1]);
    const am = Number(a[2]);
    const ad = Number(a[3]);
    const by = Number(b[1]);
    const bm = Number(b[2]);
    const bd = Number(b[3]);
    if (ay === by && am === bm) return `${ay}年${am}月${ad}日至${bd}日`;
    if (ay === by) return `${ay}年${am}月${ad}日至${bm}月${bd}日`;
    return `${ay}年${am}月${ad}日 – ${by}年${bm}月${bd}日`;
  }
  if (a) return `${Number(a[1])}年${Number(a[2])}月${Number(a[3])}日`;
  return '';
}

function formatShortDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${Number(match[2])}月${Number(match[3])}日`;
}

function scrub(text: string | null): string {
  if (!text) return '';
  if (!hasIataLeak(text)) return text;
  return text
    .replace(/[（(]\s*[A-Za-z]{2,3}\s*[)）]/g, '')
    .replace(/(^|[^A-Za-z])([A-Z]{2,3})(?![A-Za-z$])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*·\s*(·\s*)+/g, ' · ')
    .trim();
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/,/g, '').replace(/^HK\$/i, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
