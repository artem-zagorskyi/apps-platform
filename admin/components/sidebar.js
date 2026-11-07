'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { signOut } from '@/app/(panel)/actions';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ALL_APPS, APP_SECTION_GROUPS, PLATFORM_ITEMS, appSectionHref, findSection } from '@/lib/nav';
import { cn } from '@/lib/utils';

function NavLink({ href, icon: Icon, label, active, disabled, hint }) {
  const className = cn(
    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
    active && 'bg-accent font-medium text-accent-foreground',
    !active && !disabled && 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
    disabled && 'cursor-not-allowed text-muted-foreground/50',
  );

  if (disabled) {
    return (
      <span className={className} title={hint} aria-disabled="true">
        <Icon className="size-4" aria-hidden />
        {label}
      </span>
    );
  }

  return (
    <Link href={href} className={className} aria-current={active ? 'page' : undefined}>
      <Icon className="size-4" aria-hidden />
      {label}
    </Link>
  );
}

export function Sidebar({ apps, email }) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();

  // On shared pages (System, Account) there is no app in the URL
  const currentApp = params.app ?? ALL_APPS;
  const currentSection = params.section ?? 'overview';

  function switchApp(slug) {
    // Keep the open section if it works for the new choice
    const section = findSection(currentSection);
    const keep = params.app && section && (slug !== ALL_APPS || section.allApps);
    router.push(appSectionHref(slug, keep ? currentSection : 'overview'));
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-6 border-r p-4">
      <div className="grid gap-2">
        <span className="font-semibold">Apps Platform</span>
        <NativeSelect
          aria-label="App"
          value={currentApp}
          onChange={(event) => switchApp(event.target.value)}
        >
          <NativeSelectOption value={ALL_APPS}>All apps</NativeSelectOption>
          {apps.map((app) => (
            <NativeSelectOption key={app.id} value={app.slug}>
              {app.name}
              {app.status === 'disabled' ? ' (disabled)' : ''}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <nav className="grid flex-1 content-start gap-5" aria-label="Sections">
        {APP_SECTION_GROUPS.map((group) => (
          <div key={group.label} className="grid gap-1">
            <span className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </span>
            {group.items.map((item) => {
              const href = appSectionHref(currentApp, item.section);
              return (
                <NavLink
                  key={item.section}
                  href={href}
                  icon={item.icon}
                  label={item.label}
                  active={pathname.startsWith(href)}
                  disabled={currentApp === ALL_APPS && !item.allApps}
                  hint="Works per app: choose an app above"
                />
              );
            })}
          </div>
        ))}

        <div className="grid gap-1">
          <span className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Platform
          </span>
          {PLATFORM_ITEMS.map((item) => (
            <NavLink key={item.href} {...item} active={pathname.startsWith(item.href)} />
          ))}
        </div>
      </nav>

      <div className="grid gap-2 border-t pt-4">
        <Link href="/account" className="truncate text-sm hover:underline" title={email}>
          {email}
        </Link>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </aside>
  );
}