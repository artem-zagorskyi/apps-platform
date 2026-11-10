import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataTable } from '@/components/data/data-table';
import { EmptyRow, EmptyState } from '@/components/data/states';
import { StatusBadge } from '@/components/data/status-badge';
import { STATUS_TEXT, StatusDot } from '@/components/settings/shared/tab-status';
import { AppAvatar } from '@/components/shell/app-avatar';
import { PageBody, PageHeader } from '@/components/shell/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { getOverview } from '@/lib/apps';
import { ALL_APPS, SETTINGS_TABS } from '@/lib/nav';

const COLUMNS = [
  { key: 'app', header: 'App', width: 'minmax(11rem,1.2fr)' },
  { key: 'status', header: 'Status', width: '6.5rem' },
  { key: 'setup', header: 'Settings', width: '9rem' },
  { key: 'next', header: 'Next step', width: 'minmax(14rem,2fr)' },
];

const settingsHref = (slug, tab) => `/apps/${encodeURIComponent(slug)}/settings/${tab}`;

// Something broken first, then what is needed before release
function nextStep(tabs) {
  const steps = SETTINGS_TABS.filter(({ tab }) => tabs[tab]).map((step) => ({ ...step, state: tabs[step.tab] }));
  return (
    steps.find(({ state }) => state.status === 'error') ??
    steps.find(({ state }) => state.status === 'not_configured') ??
    null
  );
}

function SetupDots({ app }) {
  return (
    <span className="flex items-center">
      {SETTINGS_TABS.map(({ tab, label }) => {
        const state = app.tabs[tab];
        if (!state) return null;
        return (
          <Link
            key={tab}
            href={settingsHref(app.slug, tab)}
            title={`${label}: ${STATUS_TEXT[state.status]} · ${state.hint}`}
            aria-label={`${label}: ${STATUS_TEXT[state.status]}`}
            className="rounded p-1 hover:bg-muted"
          >
            <StatusDot status={state.status} className="size-2" />
          </Link>
        );
      })}
    </span>
  );
}

function NextStep({ app }) {
  const step = nextStep(app.tabs);
  if (!step) return <span className="text-xs text-success">Ready for release</span>;
  return (
    <Link href={settingsHref(app.slug, step.tab)} className="flex min-w-0 items-center gap-2 text-xs hover:underline">
      <StatusDot status={step.state.status} />
      <span className="shrink-0 font-medium">{step.label}</span>
      <span className="truncate text-muted-foreground">{step.state.hint}</span>
    </Link>
  );
}

export default async function OverviewPage({ params }) {
  const { app: current } = await params;
  const allMode = current === ALL_APPS;
  const apps = await getOverview();
  const shown = allMode ? apps : apps.filter((app) => app.slug === current);
  if (!allMode && shown.length === 0) notFound();

  const disabled = shown.filter((app) => app.status === 'disabled').length;
  const needSetup = shown.filter((app) => nextStep(app.tabs)).length;
  const subtitle = allMode
    ? [`${shown.length} app${shown.length === 1 ? '' : 's'}`, disabled && `${disabled} disabled`, needSetup && `${needSetup} need setup`]
        .filter(Boolean)
        .join(' · ')
    : shown[0].name;

  const rows = shown.map((app) => ({
    id: app.id,
    app: (
      <Link
        href={allMode ? `/apps/${encodeURIComponent(app.slug)}/overview` : settingsHref(app.slug, 'general')}
        className="flex min-w-0 items-center gap-2.5 hover:underline"
      >
        <AppAvatar app={app} size={22} />
        <span className="truncate text-[0.8125rem] font-medium">{app.name}</span>
      </Link>
    ),
    status: <StatusBadge status={app.status} />,
    setup: <SetupDots app={app} />,
    next: <NextStep app={app} />,
  }));

  return (
    <>
      <PageHeader title="Overview" subtitle={subtitle} />
      <PageBody>
        <div className="flex flex-col gap-4">
          <DataTable
            columns={COLUMNS}
            rows={rows}
            minWidth="40rem"
            empty={<EmptyRow>No apps yet. Create one with “+ New app” in the switcher.</EmptyRow>}
          />

          <Card>
            <CardHeader
              title="Installs, active users and the live map"
              description="Charts arrive with the analytics data step."
            />
            <CardBody>
              <EmptyState title="No charts yet">
                Daily installs and active users, retention, consent rates and a map of the cities where people use{' '}
                {allMode ? 'the apps' : 'the app'} right now will appear here.
              </EmptyState>
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </>
  );
}