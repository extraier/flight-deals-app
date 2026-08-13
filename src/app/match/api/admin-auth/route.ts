// Admin auth route for /match/admin.
//
// POST  /match/api/admin-auth           — login: verify password, issue session cookie
// GET   /match/api/admin-auth           — check current session validity (for client-side gate)
// DELETE /match/api/admin-auth          — logout: clear session cookie
//
// The session cookie is HMAC-signed (NOT the raw password) so cookie contents
// can never be replayed as credentials even if leaked via logs.
//
// Writes to Firestore are done from server-side admin mutation routes (see
// /api/admin-mutate/*), which verify this cookie then call Firestore via
// the Admin SDK (see src/lib/firebase/admin.ts).

import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE_NAME,
  issueAdminSessionCookie,
  verifyAdminSessionCookie,
} from '@/lib/firebase/admin';

export async function POST(request: Request) {
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: '無效的請求' }, { status: 400 });
  }

  const { password } = body;
  const expected = process.env.COUPLE_ADMIN_PASSWORD;

  if (!expected) {
    // Don't leak the env-var-missing state to anonymous probers — return generic 500
    console.error('admin-auth: COUPLE_ADMIN_PASSWORD env var not set');
    return NextResponse.json({ ok: false, error: '伺服器設定錯誤' }, { status: 500 });
  }

  if (!password || password !== expected) {
    // Same-shaped response for both "missing" and "wrong" so probers can't differentiate
    return NextResponse.json({ ok: false, error: '密碼錯誤' }, { status: 401 });
  }

  // Issue HMAC-signed session cookie. NOT the raw password.
  const cookie = issueAdminSessionCookie();
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: cookie.name,
    value: cookie.value,
    ...cookie.options,
  });
  return response;
}

export async function GET(request: Request) {
  // Read cookie from the incoming request — works because httpOnly cookies
  // are sent to the server even though browser JS can't see them.
  const cookieValue = request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${ADMIN_COOKIE_NAME}=`))
    ?.slice(ADMIN_COOKIE_NAME.length + 1);

  const session = verifyAdminSessionCookie(cookieValue);
  if (!session) {
    return NextResponse.json({ ok: false, authed: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, authed: true, exp: session.exp });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });
  return response;
}
