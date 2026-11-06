import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Self-hosted by Next.js at build time: browsers never contact Google.
// Cyrillic too, since user data (names, emails) may contain it.
const sans = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
});

// For ids, keys and codes
const mono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata = {
  title: 'Apps Platform',
  description: 'Admin panel of the apps platform',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}