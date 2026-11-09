'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { ALL_APPS, appSectionHref, findSection } from '@/lib/nav';
import { AppAvatar } from './app-avatar';

export function AppSwitcher({ apps, collapsed, canCreateApps }) {
  const pathname = usePathname();
  const router = useRouter();

  // /apps/<slug>/<section>/<rest>; shared pages (System, Account) have no app
  const parts = pathname.split('/');
  const inApp = parts[1] === 'apps';
  const current = inApp ? parts[2] : ALL_APPS;
  const app = apps.find((item) => item.slug === current) ?? null;
  const section = inApp ? findSection(parts[3]) : null;

  function switchTo(slug) {
    // Stay on the same page (and settings tab) if it works for the new choice
    const keep = section && (slug !== ALL_APPS || section.allApps);
    router.push(keep ? `/apps/${slug}/${parts.slice(3).join('/')}` : appSectionHref(slug, 'overview'));
  }

  return (
    <div className="flex flex-col gap-1 px-2.5 pb-2 pt-1">
      <Menu>
        <MenuTrigger
          title={collapsed ? (app?.name ?? 'All apps') : 'Switch app'}
          className="flex h-[2.375rem] w-full items-center justify-center gap-2 rounded-[0.4375rem] border border-border bg-card px-2 text-left outline-none hover:border-input focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <AppAvatar app={app} />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">{app?.name ?? 'All apps'}</span>
              <ChevronsUpDown className="size-3.5 text-muted-foreground" />
            </>
          )}
        </MenuTrigger>
        <MenuContent className="w-[14.75rem]">
          <MenuItem onClick={() => switchTo(ALL_APPS)}>
            <AppAvatar app={null} size={18} />
            <span className="flex-1">All apps</span>
            {current === ALL_APPS && <Check className="!size-3.5 text-primary" />}
          </MenuItem>
          {apps.length > 0 && <MenuSeparator />}
          {apps.map((item) => (
            // Disabled apps stay selectable: their settings are where they get enabled again
            <MenuItem key={item.id} onClick={() => switchTo(item.slug)}>
              <AppAvatar app={item} size={18} />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {item.status === 'disabled' && <span className="text-[0.6875rem] text-muted-foreground">disabled</span>}
              {item.slug === current && <Check className="!size-3.5 text-primary" />}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      {canCreateApps && (
        <Link
          href="/new-app"
          title="New app"
          className="flex h-[1.875rem] items-center justify-center gap-2 rounded-md px-2 text-[0.8125rem] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground data-[expanded=true]:justify-start"
          data-expanded={!collapsed}
        >
          <Plus className="size-4 shrink-0" aria-hidden />
          {!collapsed && 'New app'}
        </Link>
      )}
    </div>
  );
}