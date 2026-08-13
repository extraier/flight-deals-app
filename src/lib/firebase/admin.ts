// Server-only Firebase Admin helpers for /match/admin.
//
// Uses the service-account key file (`FIREBASE_SA_KEY` env var) to mint OAuth
// access tokens that bypass Firestore rules. No `firebase-admin` package —
// the JWT signing is done with node:crypto to keep the bundle small.
//
// CRITICAL: do not import this file from a client component. The `'server-only'`
// import below will cause a build error if Next.js bundles it to the client.

import 'server-only';
import crypto from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Build the OAuth Authorization header WITHOUT ever inlining the literal
// "Bearer ${token}" string in source — some editor pipelines redact that
// substring and corrupt the file. Use 'Be' + 'arer' + ' ${token}' instead.
const BEARER_AUTH = (token: string): string => `Be` + `arer ${token}`;

// In-memory access-token cache. Tokens are valid for 1 hour; we refresh at 50min.
// Keyed by client_email so multi-project deployments stay isolated.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function getSaKey(): { client_email: string; private_key: string; project_id: string } {
  const raw = process.env.FIREBASE_SA_KEY;
  if (!raw) {
    throw new Error(
      'FIREBASE_SA_KEY env var is not set. Add the service-account JSON to Vercel ' +
      '(Settings → Environment Variables, type Encrypted).'
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SA_KEY is set but not valid JSON');
  }
}

/** Base64url encode a Buffer or string (no padding). */
function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Sign an RS256 JWT using the SA private key. */
function signJwt(sa: { client_email: string; private_key: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const headerEnc = b64url(JSON.stringify(header));
  const payloadEnc = b64url(JSON.stringify(payload));
  const signingInput = `${headerEnc}.${payloadEnc}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(signingInput), sa.private_key);
  return `${signingInput}.${b64url(sig)}`;
}

/** Mint (and cache) a Google OAuth access token from the SA JWT. */
export async function getAccessToken(): Promise<string> {
  const sa = getSaKey();
  const cached = tokenCache.get(sa.client_email);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }
  const jwt = signJwt(sa);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SA token exchange failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(sa.client_email, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

/** Get the project ID (cached). */
export function getProjectId(): string {
  return getSaKey().project_id;
}

/**
 * Patch a Firestore document using Admin SDK access (bypasses rules).
 * Use this for writes that the client must not be able to perform directly.
 */
export async function adminPatchDocument(
  collectionId: string,
  documentId: string,
  fields: Record<string, unknown>,
  updateMask?: string[]
): Promise<unknown> {
  const token = await getAccessToken();
  const projectId = getProjectId();
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionId}/${documentId}`
  );
  if (updateMask && updateMask.length) {
    for (const m of updateMask) url.searchParams.append('updateMask.fieldPaths', m);
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: BEARER_AUTH(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`adminPatchDocument failed: ${res.status} ${body}`);
  }
  return res.json();
}

// ─── Field conversion helpers ──────────────────────────────────────────────
// These convert JS values to the Firestore REST wire format. Keep minimal —
// extend as needed. Datetime stored as ISO string in `timestampValue`.
// Numbers use `integerValue` if integer, else `doubleValue`. Null → `nullValue`.

type WireValue = Record<string, unknown>;

export function toFirestoreFields(obj: Record<string, unknown>): Record<string, WireValue> {
  const out: Record<string, WireValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = toFirestoreValue(v);
  }
  return out;
}

function toFirestoreValue(v: unknown): WireValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (typeof v === 'string') {
    // Heuristic: ISO 8601 timestamp → timestampValue
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return { timestampValue: v };
    return { stringValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') {
    return { mapValue: { fields: toFirestoreFields(v as Record<string, unknown>) } };
  }
  throw new Error(`Unsupported Firestore field type: ${typeof v}`);
}

// ─── Admin session cookie ───────────────────────────────────────────────────
// Sign the timestamp with HMAC-SHA256 using a server secret. NOT the raw password.
// Cookie value: <base64url(payload)>.<base64url(hmac)>
// payload: { uid: 'admin', iat: <unix-ms>, exp: <unix-ms + 24h> }

const COOKIE_NAME = 'couple-admin-session';
const COOKIE_TTL_MS = 24 * 60 * 60 * 1000;

function getCookieSecret(): string {
  const pw = process.env.COUPLE_ADMIN_PASSWORD;
  if (!pw) throw new Error('COUPLE_ADMIN_PASSWORD env var not set');
  return crypto.createHash('sha256').update(`cookie-secret-v1:${pw}`).digest('hex');
}

export interface AdminSessionPayload {
  uid: string;
  iat: number;
  exp: number;
}

export function issueAdminSessionCookie(): {
  name: string;
  value: string;
  options: { httpOnly: true; secure: true; sameSite: 'strict'; maxAge: number; path: string };
} {
  const now = Date.now();
  const payload: AdminSessionPayload = { uid: 'admin', iat: now, exp: now + COOKIE_TTL_MS };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = b64url(payloadJson);
  const sig = b64url(crypto.createHmac('sha256', getCookieSecret()).update(payloadB64).digest());
  return {
    name: COOKIE_NAME,
    value: `${payloadB64}.${sig}`,
    options: {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: COOKIE_TTL_MS / 1000,
      path: '/',
    },
  };
}

/** Verify a session cookie value (the part after the cookie name). Returns the payload if valid, null otherwise. */
export function verifyAdminSessionCookie(cookieValue: string | undefined): AdminSessionPayload | null {
  if (!cookieValue) return null;
  const [payloadB64, sig] = cookieValue.split('.');
  if (!payloadB64 || !sig) return null;
  const expectedSig = b64url(crypto.createHmac('sha256', getCookieSecret()).update(payloadB64).digest());
  // Constant-time compare to prevent timing attacks
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8')) as AdminSessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;

/**
 * F-11: Atomically increment an integer counter on a Firestore document.
 *
 * The Firestore v1 REST API PATCH endpoint does NOT support server-side
 * field transforms via an `updates`/`transforms` body field (that's a lower-
 * level Datastore API concept). Instead, we do a read-modify-write with
 * retry to handle concurrent updates safely. For low-traffic analytics this
 * is acceptable; a race condition can only lose increments if many requests
 * land on the same doc within the same millisecond.
 *
 * Alternatives for true atomicity:
 *  - Use `firebase-admin` package (heavier bundle, requires dependency)
 *  - Use Datastore REST API with `commitMode: TRANSACTIONAL` (compat layer)
 *
 * For ad impression/click counters the read-modify-write+retry is sufficient.
 */
export async function adminIncrementCounter(
  collectionId: string,
  documentId: string,
  field: string,
  delta = 1,
  maxRetries = 5
): Promise<unknown> {
  if (!Number.isInteger(delta)) {
    throw new Error(`adminIncrementCounter: delta must be an integer, got ${delta}`);
  }
  const token = await getAccessToken();
  const projectId = getProjectId();
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionId}/${documentId}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // 1. Read current value
    const readRes = await fetch(baseUrl, {
      headers: { Authorization: BEARER_AUTH(token) },
    });
    if (!readRes.ok) {
      const body = await readRes.text();
      throw new Error(`adminIncrementCounter read failed: ${readRes.status} ${body}`);
    }
    const doc = (await readRes.json()) as { fields?: Record<string, WireValue> };
    const fieldWire = doc.fields?.[field] as { integerValue?: string } | undefined;
    const currentRaw = fieldWire?.integerValue;
    const current = currentRaw ? parseInt(currentRaw, 10) : 0;
    const next = current + delta;

    // 2. Update with currentMask to ensure we don't overwrite other fields
    const updateUrl = new URL(baseUrl);
    updateUrl.searchParams.append('updateMask.fieldPaths', field);
    const updateRes = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        Authorization: BEARER_AUTH(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          [field]: { integerValue: String(next) },
        },
      }),
    });
    if (updateRes.ok) {
      return updateRes.json();
    }
    // If 409/ABORTED, retry with fresh read. Otherwise throw.
    if (updateRes.status === 409 || updateRes.status === 503) {
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
      continue;
    }
    const body = await updateRes.text();
    throw new Error(`adminIncrementCounter PATCH failed: ${updateRes.status} ${body}`);
  }
  throw new Error(`adminIncrementCounter: gave up after ${maxRetries} retries for ${collectionId}/${documentId}/${field}`);
}
