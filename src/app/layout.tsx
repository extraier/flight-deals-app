import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Nav } from '@/components/Nav';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'CompareTiger - 香港機票比價',
  description: '香港國際機場出發，最低價機票實時比較',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider>
          <Nav />
          <ThemeToggle />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
