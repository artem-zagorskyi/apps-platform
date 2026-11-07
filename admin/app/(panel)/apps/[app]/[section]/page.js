import { notFound } from 'next/navigation';
import { SectionPlaceholder } from '@/components/section-placeholder';
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
    return <SectionPlaceholder title={item.label} note="This section works per app. Choose an app in the sidebar." />;
  }

  return <SectionPlaceholder title={item.label} note="Not built yet." />;
}