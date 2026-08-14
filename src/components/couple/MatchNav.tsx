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
 * Back-button logic (pathname-aware, sessionStorage override for room context):
 *
 *   /match             → "/", label "返回機票格價" (flight deals landing)
 *   /match/wishlist
 *     with no room ctx → "/match", label "返回一起揀目的地"
 *     with room ctx   → "/match/room/{id}", label "返回情侶房間"
 *   /match/account     → "/match", label "返回一起揀目的地"
 *   /match/admin       → "/match", label "返回一起揀目的地"
 *
 * The room page does NOT use MatchNav (it has its own absolute buttons), but
 * its exit (↗) button follows the same semantics: room → flight deals ("/").
 *
 * Hermes 2026-08-14 (screenshot 5): User asked for:
 *   1. Dark/light theme toggle in same row as back button
 *   2. Back button text should say "返回機票格價" (return to flight deals)
 *   3. /match pages should follow flight.comparetiger.com color theme
 *
 * Hermes 2026-08-14 (screenshot 9): When the user opens the wishlist from
 * inside a match room, the back button should say "返回情侶房間" and link
 * to /match/room/{id} — not the generic "返回一起揀目的地" picker. The room
 * page writes a sessionStorage entry (matchWishlistBack) on click; we read
 * it here and clear it after the user clicks back, so a hard refresh of
 * the wishlist page doesn't leave a stale back link.
 *
 * Hermes 2026-08-14 (screenshot 10): Default back link on /match/wishlist
 * (when no room context) changed from "返回機票格價" to "返回一起揀目的地",
 * because the destination picker is the meaningful "back" context for the
 * /match/* subtree, not the flight deals landing page.
 *
 * Hermes 2026-08-14 (screenshot 11): On /match specifically, the back
 * button goes to "/" with label "返回機票格價" (the destination picker is
 * the OUTER page, not the back-button target). The earlier default
 * "返回一起揀目的地" was wrong on /match itself — it would loop back to
 * the same page. Fixed by varying the default per pathname.
 */
export function MatchNav() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Default back link — set per-pathname in the useEffect below.
  const [backLink, setBackLink] = useState<{ href: string; label: string }>({
    href: '/',
    label: '返回機票格價',
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Hermes 2026-08-14 (screenshots 9, 10, 11): back button logic per pathname.
  // 1. /match/wishlist with a room sessionStorage entry → return to that room.
  // 2. /match/wishlist without room context → /match (destination picker).
  // 3. /match itself → / (flight deals — the destination picker is the page,
  //    not a back target).
  // 4. /match/account or /match/admin → /match (destination picker).
  useEffect(() => {
    if (!pathname?.startsWith('/match/wishlist')) {
      // Clear any stale entry so it doesn't leak to other pages.
      try {
        sessionStorage.removeItem('matchWishlistBack');
      } catch {}
    }

    // Wishlist gets special handling: room context overrides default.
    if (pathname?.startsWith('/match/wishlist')) {
      try {
        const raw = sessionStorage.getItem('matchWishlistBack');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.href && parsed?.label) {
            setBackLink(parsed);
            return;
          }
        }
      } catch {}
      // No room context → back to destination picker.
      setBackLink({ href: '/match', label: '返回一起揀目的地' });
      return;
    }

    // /match itself → back to flight deals.
    if (pathname === '/match') {
      setBackLink({ href: '/', label: '返回機票格價' });
      return;
    }

    // /match/account, /match/admin, or any other /match/* → back to picker.
    setBackLink({ href: '/match', label: '返回一起揀目的地' });
  }, [pathname]);

  const isMatch = pathname === '/match';
  const isWishlist = pathname.startsWith('/match/wishlist');
  const isAccount = pathname.startsWith('/match/account');

  // Hermes 2026-08-14 (screenshot 9): when the back button is clicked from
  // the wishlist, clear the sessionStorage so a subsequent visit to the
  // match page doesn't try to return to a stale room.
  const handleBackClick = () => {
    try {
      sessionStorage.removeItem('matchWishlistBack');
    } catch {}
  };

  // Pill style for nav buttons — active vs inactive
  const pillBase = 'inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl shadow-sm border font-bold transition';
  const pillActive = 'bg-pink-500 dark:bg-pink-600 border-pink-500 dark:border-pink-600 text-white';
  const pillInactive = 'bg-white dark:bg-gray-900 border-pink-100 dark:border-pink-900/30 text-pink-600 dark:text-pink-400 hover:bg-pink-50 dark:hover:bg-gray-800';

  return (
    <div className="flex items-center justify-between mb-6 gap-2">
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={backLink.href}
          onClick={handleBackClick}
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium transition"
          aria-label={backLink.label}
        >
          <ArrowLeft size={16} />
          {backLink.label}
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
