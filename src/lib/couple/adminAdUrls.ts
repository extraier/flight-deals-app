/**
 * URL guards for the authenticated admin ad cards.
 *
 * Firestore documents created before the current editor may omit image or
 * clickUrl. Interpolating a missing image into CSS produces `url(undefined)`,
 * which a browser resolves relative to /match/admin as /match/undefined.
 */

function asSafeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Return a CSS background-image value only for an absolute HTTP(S) image URL.
 * This rejects missing values, literal "undefined", and relative paths, which
 * would otherwise be resolved by CSS relative to /match/admin.
 */
export function safeAdminAdBackgroundImage(value: unknown): string | undefined {
  const url = asSafeHttpUrl(value);
  return url ? `url("${url.replaceAll('"', '%22')}")` : undefined;
}

/**
 * Permit only absolute HTTP(S) URLs for the admin preview action.
 * Missing, relative, malformed, and non-web URLs leave the action disabled.
 */
export function safeAdminAdPreviewUrl(value: unknown): string | null {
  return asSafeHttpUrl(value);
}
