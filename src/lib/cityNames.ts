/**
 * Display spelling for city names that already include an airport code,
 * e.g. "馬尼拉 (MNL)". The code stays in the title so two airports in one
 * city remain distinct (東京 (NRT) vs 東京 (HND)).
 *
 * Two Traditional Chinese typos are corrected here, at the point names
 * are shown, because the fare JSON is written by the scanner with the
 * old spelling baked in. The scanner scripts are left unchanged.
 */

const CITY_SPELLING: ReadonlyArray<readonly [string, string]> = [
  ['巴塞隆拿', '巴塞羅那'],
  ['巴塞羅拿', '巴塞羅那'],
  ['洛杉矶', '洛杉磯'],
];

/** City line for a match card. The attraction title is left alone. */
export function displaySpotCity(city: string, dealCode?: string | null): string {
  const name = fixCityName(city || '');
  const code = (dealCode || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return name;
  if (name.includes(`(${code})`)) return name;
  return `${name} (${code})`;
}

/** A flight link only when the spot names a real 3-letter airport. */
export function spotFlightHref(dealCode: string | undefined, query = ''): string | null {
  const code = (dealCode || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  return `/route/${code}${query}`;
}

export function fixCityName(name: string): string {
  let out = name;
  for (const [from, to] of CITY_SPELLING) {
    if (out.includes(from)) out = out.replaceAll(from, to);
  }
  return out;
}
