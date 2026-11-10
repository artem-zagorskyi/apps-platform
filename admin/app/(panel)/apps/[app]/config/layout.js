import { MousePointerClick } from 'lucide-react';
import { SectionPlaceholder } from '@/components/section-placeholder';
import { LinkTabs } from '@/components/shell/link-tabs';
import { PageBody, PageHeader } from '@/components/shell/page-header';
import { getApp, getConfigOverview } from '@/lib/apps';
import { ALL_APPS } from '@/lib/nav';

const TABS = [
  { tab: 'parameters', label: 'Parameters' },
  { tab: 'experiments', label: 'Experiments' },
  { tab: 'results', label: 'Results' },
  { tab: 'versions', label: 'Versions' },
  { tab: 'sandbox', label: 'Sandbox' },
];

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default async function ConfigLayout({ children, params }) {
  const { app: slug } = await params;

  if (slug === ALL_APPS) {
    return (
      <SectionPlaceholder title="Config & experiments" subtitle="All apps" emptyTitle="Choose an app" icon={MousePointerClick}>
        Config and experiments belong to one app. Pick one in the switcher at the top of the sidebar.
      </SectionPlaceholder>
    );
  }

  const [{ app }, overview] = await Promise.all([getApp(slug), getConfigOverview(slug)]);
  const live = overview.live
    ? `live config v${overview.live.version} · published ${timeFormat.format(new Date(overview.live.publishedAt))}`
    : 'nothing published yet';
  const tabs = TABS.map(({ tab, label }) => ({ href: `/apps/${encodeURIComponent(slug)}/config/${tab}`, label }));

  return (
    <>
      <PageHeader
        title="Config & experiments"
        subtitle={`${app.name} · ${live}`}
        tabs={<LinkTabs tabs={tabs} label="Config and experiments" />}
      />
      <PageBody>{children}</PageBody>
    </>
  );
}
