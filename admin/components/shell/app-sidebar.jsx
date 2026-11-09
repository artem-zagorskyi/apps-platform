'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LogOut, PanelLeft } from 'lucide-react';
import { signOut } from '@/app/(panel)/actions';
import { ALL_APPS, APP_SECTION_GROUPS, PLATFORM_ITEMS, SIDEBAR_COOKIE, appSectionHref } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { AccountMenu } from './account-menu';
import { AppSwitcher } from './app-switcher';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';

function isActive(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({ href, icon: Icon, label, active, disabled, collapsed }) {
  const className = cn(
    'flex h-8 items-center gap-[0.5625rem] rounded-md px-2 text-[0.8125rem]',
    collapsed && 'justify-center',
    active ? 'bg-primary-soft font-semibold text-primary-soft-foreground' : !disabled && 'hover:bg-sidebar-accent',
    disabled && 'cursor-not-allowed opacity-45',
  );
  const content = (
    <>
      <Icon className={cn('size-4 shrink-0', active && 'text-primary')} aria-hidden />
      {!collapsed && <span className="truncate">{label}</span>}
    </>
  );

  if (disabled) {
    return (
      <span className={className} title={`${label} works per app: choose an app above`} aria-disabled="true">
        {content}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={className}
      title={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
    >
      {content}
    </Link>
  );
}

function GroupLabel({ collapsed, children }) {
  if (collapsed) {
    return <div className="mx-2 my-1.5 h-px bg-sidebar-border" />;
  }
  return <div className="px-2 py-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground">{children}</div>;
}

export function AppSidebar({ apps, email, canCreateApps, initialCollapsed }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  // /apps/<slug>/... ; shared pages count as "All apps" for the section links
  const parts = pathname.split('/');
  const currentApp = parts[1] === 'apps' ? parts[2] : ALL_APPS;

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=strict`;
  }

  return (
    <aside
      className={cn(
        'sticky top-0 z-10 flex h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        collapsed ? 'w-[3.75rem]' : 'w-[15.25rem]',
      )}
    >
      <div className={cn('flex h-[3.25rem] shrink-0 items-center gap-2', collapsed ? 'justify-center' : 'px-3.5')}>
        {collapsed ? (
          <button
            type="button"
            onClick={toggle}
            title="Expand menu"
            aria-label="Expand menu"
            className="flex size-[1.625rem] items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent"
          >
            <PanelLeft className="size-4" />
          </button>
        ) : (
          <>
            <Logo />
            <span className="flex min-w-0 flex-1 items-baseline gap-1">
              <b className="font-bold tracking-tight text-foreground">Renvix</b>
              <span className="truncate text-[0.8125rem] text-muted-foreground">Apps Platform</span>
            </span>
            <button
              type="button"
              onClick={toggle}
              title="Collapse menu"
              aria-label="Collapse menu"
              className="flex size-[1.625rem] shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent"
            >
              <PanelLeft className="size-4" />
            </button>
          </>
        )}
      </div>

      <AppSwitcher apps={apps} collapsed={collapsed} canCreateApps={canCreateApps} />

      <nav aria-label="Sections" className="flex flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-2.5 py-1">
        {APP_SECTION_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-px">
            <GroupLabel collapsed={collapsed}>{group.label}</GroupLabel>
            {group.items.map((item) => {
              const href = appSectionHref(currentApp, item.section);
              return (
                <NavItem
                  key={item.section}
                  href={href}
                  icon={item.icon}
                  label={item.label}
                  collapsed={collapsed}
                  active={isActive(pathname, href)}
                  disabled={currentApp === ALL_APPS && !item.allApps}
                />
              );
            })}
          </div>
        ))}
        <div className="flex flex-col gap-px">
          <GroupLabel collapsed={collapsed}>Platform</GroupLabel>
          {PLATFORM_ITEMS.map((item) => (
            <NavItem key={item.href} {...item} collapsed={collapsed} active={isActive(pathname, item.href)} />
          ))}
        </div>
      </nav>

      {collapsed ? (
        <div className="flex shrink-0 justify-center border-t border-sidebar-border py-2.5">
          <AccountMenu email={email} />
        </div>
      ) : (
        <div className="flex shrink-0 flex-col gap-2.5 border-t border-sidebar-border p-2.5">
          <ThemeToggle />
          <div className="flex items-center gap-2 px-0.5">
            <Link
              href="/account"
              title="My account"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-foreground"
            >
              {email[0].toUpperCase()}
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs font-medium text-foreground" title={email}>
                {email}
              </span>
              <Link href="/account" className="text-xs text-muted-foreground hover:underline">
                My account
              </Link>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                title="Sign out"
                aria-label="Sign out"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              >
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}