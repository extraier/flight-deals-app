'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: '主頁' },
  { href: '/deals', label: '今日劈價 🔥' },
  { href: '/worldcup', label: '世界盃' },
  { href: '/trump', label: 'Trump' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-40">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2">
        <Link href="/" className="text-sm font-bold tracking-tight text-foreground">
          CompareTiger
        </Link>
        <div className="flex flex-wrap gap-1">
          {links.map((l) => {
            const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
