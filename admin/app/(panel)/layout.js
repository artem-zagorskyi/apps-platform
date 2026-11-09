import { cookies } from 'next/headers';
import { AppSidebar } from '@/components/shell/app-sidebar';
import { getVisibleApps } from '@/lib/apps';
import { SIDEBAR_COOKIE } from '@/lib/nav';
import { requireSession } from '@/lib/session';

// Every page in this group needs a live admin session
export default async function PanelLayout({ children }) {
  const session = await requireSession();
  const apps = await getVisibleApps();
  const canCreateApps = session.roles.some((grant) => grant.role === 'owner' && grant.appId === null);
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === 'collapsed';

  return (
    <div className="flex min-h-screen">
      <AppSidebar apps={apps} email={session.email} canCreateApps={canCreateApps} initialCollapsed={collapsed} />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}