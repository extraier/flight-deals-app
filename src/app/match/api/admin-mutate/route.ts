// Server-side admin mutations for /match/admin.
//
// All writes go through the Admin SDK (service-account access token) and
// bypass Firestore rules. The `coupleAds` rule `allow write: if false` is
// therefore safe — clients cannot write directly even if they obtain a
// session cookie, because they never see the SA access token.
//
// POST /match/api/admin-mutate
// body: { collection: 'coupleAds' | 'coupleSpots', id: string, fields: { ... } }
// optional query: ?updateMask=field1&updateMask=field2
//
// The browser must present a valid session cookie issued by /api/admin-auth.

import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE_NAME,
  verifyAdminSessionCookie,
  adminPatchDocument,
  adminDeleteDocument,
} from '@/lib/firebase/admin';

const ALLOWED_COLLECTIONS = new Set(['coupleAds', 'coupleSpots']);

export async function POST(request: Request) {
  // 1. Verify session cookie
  const cookieValue = request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${ADMIN_COOKIE_NAME}=`))
    ?.slice(ADMIN_COOKIE_NAME.length + 1);
  const session = verifyAdminSessionCookie(cookieValue);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse body
  let body: { collection?: string; id?: string; fields?: Record<string, unknown>; delete?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: '無效的請求' }, { status: 400 });
  }
  const { collection, id, fields, delete: isDelete } = body;
  if (!collection || !id) {
    return NextResponse.json(
      { ok: false, error: '缺少 collection / id' },
      { status: 400 }
    );
  }
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    return NextResponse.json(
      { ok: false, error: `不允許的 collection: ${collection}` },
      { status: 400 }
    );
  }

  // 3. Optional updateMask from query string
  const url = new URL(request.url);
  const updateMask = url.searchParams.getAll('updateMask');

  // 4. Perform admin write — DELETE branch (skip fields)
  if (isDelete) {
    try {
      const result = await adminDeleteDocument(collection, id);
      return NextResponse.json({ ok: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('admin-delete failed:', message);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  if (typeof fields !== 'object' || fields === null) {
    return NextResponse.json(
      { ok: false, error: '缺少 fields (或設定 delete: true)' },
      { status: 400 }
    );
  }

  // 5. PATCH branch
  try {
    const result = await adminPatchDocument(collection, id, fields, updateMask);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('admin-mutate failed:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
