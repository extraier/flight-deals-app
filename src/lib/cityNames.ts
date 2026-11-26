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
  ['巴塞羅拿', '巴塞羅那'],
  ['洛杉矶', '洛杉磯'],
];

export function fixCityName(name: string): string {
  let out = name;
  for (const [from, to] of CITY_SPELLING) {
    if (out.includes(from)) out = out.replaceAll(from, to);
  }
  return out;
}
