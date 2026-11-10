import { notFound, redirect } from 'next/navigation';
import { AppsTable } from '@/components/overview/apps-table';
import { AttentionList } from '@/components/overview/attention-list';
import { AutoRefresh } from '@/components/overview/auto-refresh';
import { LiveMap } from '@/components/overview/live-map';
import { OverviewTile } from '@/components/overview/metric-tile';
import { RecentChanges } from '@/components/overview/recent-changes';
import { PageBody, PageHeader } from '@/components/shell/page-header';
import { AdminApiError, adminApi } from '@/lib/admin-api';
import { ALL_APPS } from '@/lib/nav';
import { change, money, num, pct } from '@/lib/overview-format';

const TECHNICAL = { kind: 'technical' };
const STORE = { kind: 'store', label: 'Store' };

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });

async function loadOverview(app) {
  try {
    return await adminApi(`/overview?app=${encodeURIComponent(app)}`);
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) redirect('/login');
    if (err instanceof AdminApiError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
}

// The twelve numbers of one app, in the order of the design
function tilesOf(m) {
  const revenue = m.revenue7d[0];
  const moreCurrencies = m.revenue7d.length - 1;
  return [
    { label: 'New installs · 24 h', definition: 'Installs in the last 24 hours', source: TECHNICAL, value: num(m.installs24h.value), spark: m.installs7d.spark, change: change(m.installs24h), sub: 'vs yesterday' },
    { label: 'New installs · 7 d', definition: 'Installs in the last 7 days', source: TECHNICAL, value: num(m.installs7d.value), spark: m.installs7d.spark, change: change(m.installs7d), sub: 'vs prev 7 d' },
    { label: 'DAU', definition: 'Installations active on a day, average over the last 7 complete days', source: TECHNICAL, value: num(m.dau.value), spark: m.dau.spark, change: change(m.dau), sub: 'vs prev 7 d' },
    { label: 'WAU', definition: 'Installations active in the last 7 days', source: TECHNICAL, value: num(m.wau.value), spark: m.wau.spark, change: change(m.wau), sub: 'vs prev 7 d' },
    { label: 'MAU', definition: 'Installations active in the last 30 days', source: TECHNICAL, value: num(m.mau.value), spark: m.mau.spark, change: change(m.mau), sub: 'vs prev 7 d' },
    { label: 'Stickiness · DAU/MAU', definition: 'How many of the monthly users come on an average day', source: TECHNICAL, value: pct(m.stickiness.value), spark: m.stickiness.spark, change: change(m.stickiness, { rate: true }), sub: 'vs prev 7 d' },
    { label: 'Retention D1', definition: `Installs of the last cohort that came back the next day (${num(m.retentionD1.cohort)} installs)`, source: TECHNICAL, value: pct(m.retentionD1.value), change: change(m.retentionD1, { rate: true }), sub: 'vs prev cohort' },
    { label: 'Retention D7', definition: `Installs of the last cohort that came back on day 7 (${num(m.retentionD7.cohort)} installs)`, source: TECHNICAL, value: pct(m.retentionD7.value), change: change(m.retentionD7, { rate: true }), sub: 'vs prev cohort' },
    { label: 'Active subscribers', definition: 'People with a subscription that gives access now, test purchases excluded', source: STORE, value: num(m.subscribers.value), sub: 'now' },
    { label: 'Revenue · 7 d', definition: 'Purchases and renewals at store prices, before store fees and taxes', source: STORE, value: revenue ? money(revenue.value, revenue.currency) : money(0, 'EUR'), change: revenue ? change(revenue) : null, sub: moreCurrencies > 0 ? `+ ${moreCurrencies} more currenc${moreCurrencies === 1 ? 'y' : 'ies'}` : 'vs prev 7 d' },
    { label: 'Analytics consent rate', definition: 'Active installations of the last 7 days whose user allows analytics', source: TECHNICAL, value: pct(m.consentRate.value), change: change(m.consentRate, { rate: true }), sub: 'vs prev 7 d' },
    { label: 'Linked accounts', definition: 'Users with a Google, Apple or own account linked', source: TECHNICAL, value: num(m.linkedAccounts.value), change: change(m.linkedAccounts), sub: 'vs prev 7 d' },
  ];
}

export default async function OverviewPage({ params }) {
  const { app: current } = await params;
  const all = current === ALL_APPS;
  const overview = await loadOverview(current);
  const { apps, live, recentChanges } = overview;
  const generatedAt = new Date(overview.generatedAt);
  const date = dayFormat.format(generatedAt);

  const activeApps = apps.filter((app) => app.status === 'active').length;
  const disabledApps = apps.length - activeApps;
  const subtitle = all
    ? [`All apps · ${activeApps} active`, disabledApps && `${disabledApps} disabled`, date].filter(Boolean).join(' · ')
    : `${apps[0]?.name ?? current} · ${date} · changes vs previous period`;
  const single = all ? null : apps[0];
  const mau = apps.reduce((total, app) => total + (app.metrics.mau.value ?? 0), 0);
  const consentRate = single
    ? single.metrics.consentRate.value
    : mau
      ? apps.reduce((total, app) => total + (app.metrics.consentRate.value ?? 0) * (app.metrics.mau.value ?? 0), 0) / mau
      : null;

  return (
    <>
      <AutoRefresh />
      <PageHeader
        title="Overview"
        subtitle={subtitle}
        actions={<span className="text-xs text-muted-foreground">Updated {timeFormat.format(generatedAt)}</span>}
      />
      <PageBody>
        {all ? (
          <AppsTable apps={apps} />
        ) : (
          single && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-3">
              {tilesOf(single.metrics).map((tile) => (
                <OverviewTile key={tile.label} {...tile} />
              ))}
            </div>
          )
        )}

        <LiveMap live={live} apps={apps} consentRate={consentRate} showLegend={all} />

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <AttentionList apps={apps} showApp={all} />
          {recentChanges && <RecentChanges entries={recentChanges} />}
        </div>
      </PageBody>
    </>
  );
}
