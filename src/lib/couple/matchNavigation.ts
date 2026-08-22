/**
 * Hermes 2026-08-22 (Manus Defect A + admin page fix):
 *   Single source of truth for the persisted match-room back-link used
 *   by MatchNav.tsx and written by /match/room/[id]/page.tsx.
 *
 *   Background: the previous parser only checked `typeof === 'string'`,
 *   so a malformed sessionStorage value (`{"href":"/match/undefined"}`)
 *   slipped through and produced a 404 GET on /match/undefined every
 *   time the wishlist page opened. The strict regex guard below rejects
 *   any value that isn't a well-formed room path.
 */

export type MatchWishlistBack = { href: string; label: string };

// Alphabet mirrors generateRoomCode() in lib/couple/room.ts — Crockford-ish
// (no I/O/0/1 to avoid confusion). 32^8 ≈ 1.1T possible IDs.
const ROOM_ID = '[A-HJ-NP-Z2-9]{8}';
const ROOM_ID_RE = new RegExp(`^${ROOM_ID}$`);
export const ROOM_HREF_RE = new RegExp(`^/match/room/${ROOM_ID}$`);

/**
 * Parse the raw sessionStorage value for the wishlist back-link. Returns
 * null for anything malformed — including null/empty input, invalid JSON,
 * wrong shape, or a href that doesn't match a real room path.
 */
export function parseMatchWishlistBack(raw: string | null): MatchWishlistBack | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as { href?: unknown }).href === 'string' &&
      typeof (value as { label?: unknown }).label === 'string' &&
      ROOM_HREF_RE.test((value as { href: string }).href)
    ) {
      return value as MatchWishlistBack;
    }
  } catch {
    // Invalid browser state safely falls through to null.
  }
  return null;
}

/**
 * Build a room href from a candidate room ID. Returns null if the ID
 * doesn't match the room alphabet — defense in depth so a malformed
 * caller can't write garbage into sessionStorage.
 */
export function buildMatchRoomHref(roomId: string): string | null {
  return ROOM_ID_RE.test(roomId) ? `/match/room/${roomId}` : null;
}