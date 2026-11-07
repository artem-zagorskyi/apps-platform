import { notFound } from 'next/navigation';
import { getVisibleApps } from '@/lib/apps';
import { ALL_APPS } from '@/lib/nav';

// An unknown slug, or an app the admin has no role on, is a 404.
// Convenience only: the admin API checks access on every request itself.
export default async function AppLayout({ children, params }) {
  const { app } = await params;

  if (app !== ALL_APPS) {
    const apps = await getVisibleApps();
    if (!apps.some((visible) => visible.slug === app)) {
      notFound();
    }
  }

  return children;
}