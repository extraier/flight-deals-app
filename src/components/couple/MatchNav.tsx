'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Heart, Users } from 'lucide-react';

/**
 * Persistent top nav for the /match/* subtree. Used by /match, /match/wishlist,
 * /match/account, and /match/admin. Highlights the current page with a pink
 * background so users know where they are.
 *
 * Hermes 2026-08-14: User feedback — persistent nav (wishlist + account) should
 * sit at the top, not below the main CTA. This component consolidates the
 * repeated "back arrow + heart/account" pattern that was duplicated across all
 * 4 match pages.
 */
export function MatchNav() {
  const pathname = usePathname();

  const isMatch = pathname === '/match';
  const isWishlist = pathname.startsWith('/match/wishlist');
  const isAccount = pathname.startsWith('/match/account');

  // Pill style for nav buttons — active vs inactive
  const pillBase = 'inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl shadow-sm border font-bold transition';
  const pillActive = 'bg-pink-500 dark:bg-pink-600 border-pink-500 dark:border-pink-600 text-white';
  const pillInactive = 'bg-white dark:bg-gray-900 border-pink-100 dark:border-pink-900/30 text-pink-600 dark:text-pink-400 hover:bg-pink-50 dark:hover:bg-gray-800';

  return (
    <div className="flex items-center justify-between mb-6 gap-2">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium transition shrink-0"
      >
        <ArrowLeft size={16} />
        返回主頁
      </Link>
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