'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SETTINGS_TABS } from '@/lib/nav';
import { cn } from '@/lib/utils';

export function SettingsTabs({ app }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1 border-b" aria-label="Settings">
      {SETTINGS_TABS.map(({ tab, label }) => {
        const href = `/apps/${app}/settings/${tab}`;
        const active = pathname.startsWith(href);
        return (
          <Link
            key={tab}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              active
                ? 'border-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}