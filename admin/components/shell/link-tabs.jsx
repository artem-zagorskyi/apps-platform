'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

// Page tabs that are routes (one URL per tab), styled like the kit's PageTabs.
// tabs: [{ href, label }]
export function LinkTabs({ tabs, label }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="-mb-px flex gap-0.5 overflow-x-auto [scrollbar-width:none]">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-[2.375rem] items-center whitespace-nowrap border-b-2 px-2.5 text-[0.8125rem] outline-none focus-visible:bg-accent',
              active
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}