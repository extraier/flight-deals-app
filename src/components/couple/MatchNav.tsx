'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { ArrowLeft, Heart, Users, Sun, Moon } from 'lucide-react';

/**
 * Persistent top nav for the /match/* subtree. Used by /match, /match/wishlist,
 * /match/account, and /match/admin. Highlights the current page with a pink
 * background so users know where they are.
 *
 * Hermes 2026-08-14: User feedback — persistent nav (wishlist + account) should
 * sit at the top, not below the main CTA. This component consolidates the
 * repeated "back arrow + heart/account" pattern that was duplicated across all
 * 4 match pages.
 *
 * Hermes 2026-08-14 (screenshot 5): User asked for:
 *   1. Dark/light theme toggle in same row as back button
 *   2. Back button text should say "返回機票格價" (return to flight deals)
 *   3. /match pages should follow flight.comparetiger.com color theme
 *
 * For (3): the layout.tsx already wraps everything in ThemeProvider +
 * ThemeToggle, so the theme is global. We just consume the same theme here
 * via useTheme() and render a second toggle in the nav row for discoverability.
 */
export function MatchNav() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isMatch = pathname === '/match';
  const isWishlist = pathname.startsWith('/match/wishlist');
  const isAccount = pathname.startsWith('/match/account');

  // Pill style for nav buttons — active vs inactive
  const pillBase = 'inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl shadow-sm border font-bold transition';
  const pillActive = 'bg-pink-500 dark:bg-pink-600 border-pink-500 dark:border-pink-600 text-white';
  const pillInactive = 'bg-white dark:bg-gray-900 border-pink-100 dark:border-pink-900/30 text-pink-600 dark:text-pink-400 hover:bg-pink-50 dark:hover:bg-gray-800';

  return (
    <div className="flex items-center justify-between mb-6 gap-2">
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/"
          // Hermes 2026-08-14 (screenshot 5): back button text changed from
          // '返回主頁' to '返回機票格價' per user request. flight.comparetiger.com
          // is the flight deals page; users came from there to enter /match.
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium transition"
        >
          <ArrowLeft size={16} />
          返回機票格價
        </Link>

        {/* Hermes 2026-08-14 (screenshot 5): theme toggle in the same row as
            the back button so users don't have to hunt for it. Matches the
            global ThemeToggle in the layout, but this one is inline with
            the nav so it's discoverable on /match/* pages. */}
        {mounted && (
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? '切換到淺色主題' : '切換到深色主題'}
            className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-pink-100 dark:border-pink-900/30 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-pink-50 dark:hover:bg-gray-800 transition shadow-sm"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <Link
          href="/match/wishlist"
          className={`${pillBase} ${isWishlist ? pillActive : pillInactive}`}
          aria-current={isWishlist ? 'page' : undefined}
        >
          <Heart size={14} />
          <span className="hidden sm:inline">心願清單</span>
        </Link>
        <Link
          href="/match/account"
          className={`${pillBase} ${isAccount ? pillActive : pillInactive}`}
          aria-current={isAccount ? 'page' : undefined}
        >
          <Users size={14} />
          <span className="hidden sm:inline">帳戶</span>
        </Link>
      </div>
    </div>
  );
}