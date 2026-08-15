'use client';

import { useTheme } from 'next-themes';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  // Hermes 2026-08-14: standard next-themes hydration pattern. The
  // `mounted` flag delays rendering until after hydration so the server
  // and client agree on the theme. This IS a legitimate effect — we
  // can't derive `mounted` from props/state, and switching to
  // useSyncExternalStore would require upstream changes to next-themes.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setMounted(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Hermes 2026-08-14 (screenshot 6): hide the global ThemeToggle on
  // /match/room/* pages — the room has its own top-right exit button
  // (absolute top-2 right-2) that the global toggle was overlapping.
  // /match/wishlist, /match/account, /match/admin all use MatchNav which
  // has its own theme toggle button, so the global one is redundant there
  // too. Show it only on the home page (/) where it's the primary
  // dark/light switch.
  const isMatchRoom = pathname?.startsWith('/match/room');
  const isMatchSubtree = pathname?.startsWith('/match');
  if (isMatchSubtree) return null;

  if (!mounted) return null;

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="fixed top-4 right-4 z-50 rounded-full p-2.5 bg-secondary text-secondary-foreground hover:bg-accent transition-colors shadow-lg"
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
    </button>
  );
}
