import { MousePointerClick } from 'lucide-react';
import { notFound } from 'next/navigation';
import { SectionPlaceholder } from '@/components/section-placeholder';
import { getVisibleApps } from '@/lib/apps';
import { ALL_APPS, findSection } from '@/lib/nav';

// Sections without a page of their own yet. A real page such as
// apps/[app]/config/page.js takes precedence over this route by itself.
export default async function SectionPage({ params }) {
  const { app, section } = await params;
  const item = findSection(section);

  if (!item) {
    notFound();
  }

  if (app === ALL_APPS && !item.allApps) {
    return (
      <SectionPlaceholder title={item.label} subtitle="All apps" emptyTitle="Choose an app" icon={MousePointerClick}>
        This section works per app. Pick one in the switcher at the top of the sidebar.
      </SectionPlaceholder>
    );
  }

  const apps = await getVisibleApps();
  const name = app === ALL_APPS ? 'All apps' : (apps.find((visible) => visible.slug === app)?.name ?? app);

  return (
    <SectionPlaceholder title={item.label} subtitle={name}>
      This section comes in a later step of the admin plan.
    </SectionPlaceholder>
  );
}