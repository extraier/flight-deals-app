// Edge middleware-style auth helper for /couple/admin.
// Checks for a cookie `couple-admin-token` that matches `COUPLE_ADMIN_PASSWORD`.
// In a hardended build we'd use a server-set cookie; here we use a simple shared
// secret sent in the Authorization header for the admin API.
//
// Server-side only. Read COUPLE_ADMIN_PASSWORD from env.

import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json();
  const { password } = body;
  const expected = process.env.COUPLE_ADMIN_PASSWORD;

  if (!expected) {
    return NextResponse.json({ ok: false, error: 'Admin password not configured' }, { status: 500 });
  }

  if (password === expected) {
    // Issue a session cookie that expires in 24 hours
    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: 'couple-admin-token',
      value: password, // simplified: same secret as the token
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24,
    });
    return response;
  }

  return NextResponse.json({ ok: false, error: '密碼錯誤' }, { status: 401 });
}
