import { Sidebar } from '@/components/sidebar';
import { getVisibleApps } from '@/lib/apps';
import { requireSession } from '@/lib/session';

// Every page in this group needs a live admin session
export default async function PanelLayout({ children }) {
  const session = await requireSession();
  const apps = await getVisibleApps();

  const canCreateApps = session.roles.some((grant) => grant.role === 'owner' && grant.appId === null);

  return (
    <div className="flex min-h-screen">
      <Sidebar apps={apps} email={session.email} canCreateApps={canCreateApps} />
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}