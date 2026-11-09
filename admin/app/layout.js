import { Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

// Self-hosted by Next.js at build time: browsers never contact Google.
// Cyrillic too, since user data (names, emails) may contain it.
const sans = Inter({ subsets: ['latin', 'cyrillic'], variable: '--font-inter', display: 'swap' });
// For ids, keys and codes
const mono = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], variable: '--font-jetbrains-mono', display: 'swap' });

export const metadata = {
  title: 'Renvix Apps Platform',
  description: 'Admin panel of the Renvix apps platform',
};

export default function RootLayout({ children }) {
  return (
    // next-themes sets the theme class before React loads, hence the warning suppression
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delay={300}>
            <ToastProvider>{children}</ToastProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}