import { MousePointerClick } from 'lucide-react';
import { SectionPlaceholder } from '@/components/section-placeholder';
import { LinkTabs } from '@/components/shell/link-tabs';
import { PageBody, PageHeader } from '@/components/shell/page-header';
import { getVisibleApps } from '@/lib/apps';
import { ALL_APPS, SETTINGS_TABS } from '@/lib/nav';

export default async function SettingsLayout({ children, params }) {
  const { app } = await params;

  if (app === ALL_APPS) {
    return (
      <SectionPlaceholder title="App settings" subtitle="All apps" emptyTitle="Choose an app" icon={MousePointerClick}>
        Settings belong to one app. Pick one in the switcher at the top of the sidebar.
      </SectionPlaceholder>
    );
  }

  const apps = await getVisibleApps();
  const name = apps.find((visible) => visible.slug === app)?.name ?? app;
  const tabs = SETTINGS_TABS.map(({ tab, label }) => ({ href: `/apps/${app}/settings/${tab}`, label }));

  return (
    <>
      <PageHeader title="App settings" subtitle={name} tabs={<LinkTabs tabs={tabs} label="Settings" />} />
      <PageBody>
        <div className="max-w-3xl">{children}</div>
      </PageBody>
    </>
  );
}