'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import {
  signInWithGoogle,
  signUpWithEmail,
  signInWithEmail,
  signOut,
  isAnonymous,
  providerLabel,
} from '@/lib/firebase/auth-providers';
import { ensureUserProfile } from '@/lib/couple/user-profile';
import {
  Mail,
  Lock,
  LogIn,
  LogOut,
  User as UserIcon,
  Sparkles,
  ArrowLeft,
} from 'lucide-react';
import type { User } from 'firebase/auth';

type Mode = 'login' | 'signup' | null;

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const onAuthSuccess = async (u: User) => {
    try {
      await ensureUserProfile(u);
    } catch (err: any) {
      // Non-fatal — the wishlist write will surface the real error.
      console.warn('ensureUserProfile failed:', err);
    }
    setUser(u);
    setError('');
    setEmail('');
    setPassword('');
    setMode(null);
  };

  const handleGoogle = async () => {
    setBusy(true);
    setError('');
    try {
      if (user && isAnonymous(user)) {
        setError('請先登出匿名模式再使用 Google 登入（右上「登出」）');
        return;
      }
      const cred = await signInWithGoogle();
      await onAuthSuccess(cred.user);
    } catch (err: any) {
      setError('Google 登入失敗: ' + (err.message || String(err)));
    } finally {
      setBusy(false);
    }
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || password.length < 6) {
      setError('請填 email + 密碼（最少 6 位）');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const cred = mode === 'signup'
        ? await signUpWithEmail(email, password)
        : await signInWithEmail(email, password);
      await onAuthSuccess(cred.user);
    } catch (err: any) {
      const code = err?.code ?? '';
      const msg = code === 'auth/email-already-in-use'
        ? '此 email 已被註冊，請用「登入」模式'
        : code === 'auth/invalid-credential'
        ? 'Email 或密碼錯誤'
        : err.message || String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
      setUser(null);
      setMode(null);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 via-rose-50 to-pink-100">
        <div className="text-gray-400 text-sm">驗證中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-rose-50 to-pink-100 dark:from-gray-950 dark:via-pink-950/30 dark:to-gray-950 px-4 py-8">
      <div className="mx-auto max-w-md">
        <Link
          href="/match"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft size={16} /> 返回配對頁
        </Link>

        <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-xl border border-pink-100 dark:border-pink-900/30">
          <div className="text-center mb-6">
            <div className="inline-flex w-16 h-16 rounded-full bg-pink-100 dark:bg-pink-900/30 items-center justify-center mb-3">
              <UserIcon size={28} className="text-pink-500" />
            </div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white">帳戶</h1>
          </div>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {user ? (
            <div className="space-y-4">
              <div className="bg-pink-50 dark:bg-pink-900/20 rounded-2xl p-4 border border-pink-100">
                <div className="flex items-center gap-2 text-xs uppercase font-bold text-pink-600 mb-1">
                  <Sparkles size={14} /> 已登入
                </div>
                <div className="font-bold text-gray-900 dark:text-white text-lg truncate">
                  {user.displayName || user.email || '匿名用戶'}
                </div>
                {user.email && (
                  <div className="text-sm text-gray-600 dark:text-gray-400 truncate">{user.email}</div>
                )}
                <div className="text-xs text-gray-500 mt-2">
                  登入方式: {providerLabel(user)}
                </div>
              </div>

              <Link
                href="/match/wishlist"
                className="block w-full text-center bg-gradient-to-r from-pink-500 to-rose-500 text-white font-bold py-3 rounded-2xl shadow-lg hover:scale-[1.02] transition"
              >
                💖 開啟心願清單
              </Link>

              <button
                onClick={handleSignOut}
                disabled={busy}
                className="w-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold py-3 rounded-2xl hover:bg-gray-200 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <LogOut size={18} /> {busy ? '登出中...' : '登出'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={handleGoogle}
                disabled={busy}
                className="w-full bg-white border border-gray-300 text-gray-800 font-bold py-3 rounded-2xl hover:bg-gray-50 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                用 Google 登入
              </button>

              <div className="relative my-3">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white dark:bg-gray-900 px-2 text-gray-500">或用 Email</span>
                </div>
              </div>

              {!mode && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setMode('login')}
                    disabled={busy}
                    className="flex-1 bg-pink-500 text-white font-bold py-3 rounded-2xl hover:bg-pink-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <LogIn size={18} /> 登入
                  </button>
                  <button
                    onClick={() => setMode('signup')}
                    disabled={busy}
                    className="flex-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold py-3 rounded-2xl hover:bg-gray-200 transition disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Sparkles size={18} /> 註冊
                  </button>
                </div>
              )}

              {mode && (
                <form onSubmit={handleEmail} className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                        className="w-full pl-10 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">密碼</label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="最少 6 位"
                        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                        className="w-full pl-10 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-400"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full bg-gradient-to-r from-pink-500 to-rose-500 text-white font-bold py-3 rounded-2xl hover:opacity-90 transition disabled:opacity-50"
                  >
                    {busy ? '處理中...' : (mode === 'signup' ? '建立帳戶' : '登入')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode(null); setError(''); }}
                    className="w-full text-sm text-gray-500 hover:text-gray-700"
                  >
                    取消
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-500 text-center mt-6">
          登入後 Like 一張卡會自動加入心願清單 📌
        </p>
      </div>
    </div>
  );
}
