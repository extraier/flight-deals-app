/**
 * Hermes 2026-08-22 (Manus Defect A regression):
 *   Fail if a future change accepts a malformed persisted room back-link,
 *   a href that doesn't match a real room path, or a non-string field.
 */
import {
  buildMatchRoomHref,
  parseMatchWishlistBack,
} from '../matchNavigation';

describe('match wishlist back-link parsing', () => {
  test.each<[unknown]>([
    [null],
    [''],
    ['not-json'],
    ['{"href":"/match/undefined","label":"x"}'],
    ['{"href":"/match/room/short","label":"x"}'],
    ['{"href":"/match/room/EOOG","label":"x"}'], // O excluded from alphabet
    ['{"href":"/match/room/ABCDEFG1","label":"x"}'], // 1 excluded
    ['{"href":"https://example.com","label":"x"}'],
    ['{"href":"/match/room/ABCDEFG2","label":5}'], // label must be string
    ['{"href":"/match/room/ABCDEFG2"}'],            // missing label
    ['{"label":"x"}'],                               // missing href
    ['{}'],
    ['null'],
  ])('rejects invalid persisted value %p', (raw) => {
    expect(parseMatchWishlistBack(raw as string | null)).toBeNull();
  });

  test('accepts one well-formed room backlink', () => {
    expect(
      parseMatchWishlistBack(
        '{"href":"/match/room/ABCDEFG2","label":"返回情侶房間"}'
      )
    ).toEqual({
      href: '/match/room/ABCDEFG2',
      label: '返回情侶房間',
    });
  });

  test('builds a link only from a valid room ID', () => {
    expect(buildMatchRoomHref('ABCDEFG2')).toBe('/match/room/ABCDEFG2');
    expect(buildMatchRoomHref('23456789')).toBe('/match/room/23456789');
    expect(buildMatchRoomHref('undefined')).toBeNull();
    expect(buildMatchRoomHref('')).toBeNull();
    expect(buildMatchRoomHref('abc')).toBeNull();
    expect(buildMatchRoomHref('ABCDEFGHI')).toBeNull();
    expect(buildMatchRoomHref('EOOG')).toBeNull(); // O excluded
    expect(buildMatchRoomHref('ABCDEFG1')).toBeNull(); // 1 excluded
  });
});