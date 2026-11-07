import { redirect } from 'next/navigation';
import { getVisibleApps } from '@/lib/apps';
import { ALL_APPS, appSectionHref } from '@/lib/nav';

// The start page: straight to the only app, or to the summary of all
export default async function HomePage() {
  const apps = await getVisibleApps();
  redirect(appSectionHref(apps.length === 1 ? apps[0].slug : ALL_APPS, 'overview'));
}