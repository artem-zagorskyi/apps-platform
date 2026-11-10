import { and, count, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { purchases } from '../billing/schema.js';
import { events } from '../events/events-table.js';
import { PRESENCE_WINDOW_MS } from '../events/presence.js';
import { rejectionCounts } from '../events/schema.js';
import type { AdminApp } from './apps-service.js';
import { listAuditLog } from './audit-service.js';
import { getSettingsStatus } from './settings-status.js';

// Overview of one app or of every app the admin can see. Usage numbers come
// from identity.activity_days and identity.installations (all users,
// "Technical"); subscribers and revenue from billing (store data, no test
// purchases). Days are UTC; "current" periods end with yesterday, the last
// complete day.

const DAY_MS = 24 * 60 * 60 * 1000;
// Days in the sparklines; also covers "previous 7 days" for every comparison
const SPARK_DAYS = 14;
// Groups smaller than this are not placed on the live map for viewers
const VIEWER_MIN_GROUP = 5;

export interface Metric {
  value: number | null;
  // Same measure for the period before; null when it cannot be told
  previous: number | null;
  spark?: number[];
}

export interface RetentionMetric extends Metric {
  // Installs in the cohort the value is computed from
  cohort: number;
}

export interface AppMetrics {
  installs24h: Metric;
  installs7d: Metric;
  dau: Metric; // average per day over the last 7 days
  wau: Metric;
  mau: Metric;
  stickiness: Metric; // DAU / MAU, a fraction
  retentionD1: RetentionMetric; // fractions
  retentionD7: RetentionMetric;
  subscribers: Metric;
  // Gross, before store fees and taxes, per currency
  revenue7d: { currency: string; value: number; previous: number }[];
  consentRate: Metric; // share of active installations with analytics consent
  linkedAccounts: Metric;
}

export type AttentionItem =
  | { kind: 'setting_error'; severity: 'critical'; tab: string; hint: string }
  | { kind: 'setup_incomplete'; severity: 'warning'; tabs: string[] }
  | { kind: 'invalid_events'; severity: 'warning'; count: number; event: string | null }
  | { kind: 'refused_events'; severity: 'warning'; count: number; appVersion: string | null }
  | { kind: 'grace_period'; severity: 'warning'; count: number; product: string | null };

const utcDay = (time: Date) => time.toISOString().slice(0, 10);
const shiftDay = (day: string, days: number) => utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));
const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);
const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

// app_id in (...) for raw queries; callers never pass an empty list
const appIn = (column: SQL, ids: string[]) => sql`${column} in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`;

async function rows<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

// Daily, weekly and monthly active installations for each day of the window
async function activeSeries(ids: string[], firstDay: string, lastDay: string) {
  return rows<{ app_id: string; day: string; dau: number; wau: number; mau: number }>(sql`
    with days as (
      select gs::date as day from generate_series(${firstDay}::date, ${lastDay}::date, interval '1 day') gs
    )
    select a.app_id, days.day::text as day,
      count(distinct a.installation_id) filter (where a.day = days.day)::int as dau,
      count(distinct a.installation_id) filter (where a.day > days.day - 7)::int as wau,
      count(distinct a.installation_id)::int as mau
    from days
    join identity.activity_days a on a.day > days.day - 30 and a.day <= days.day
    where ${appIn(sql`a.app_id`, ids)}
    group by a.app_id, days.day`);
}

async function installCounts(ids: string[], now: Date, firstDay: string) {
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const [totals, daily] = await Promise.all([
    rows<{ app_id: string; last24: number; prev24: number; last7: number; prev7: number }>(sql`
      select app_id,
        count(*) filter (where created_at >= ${at(DAY_MS)})::int as last24,
        count(*) filter (where created_at >= ${at(2 * DAY_MS)} and created_at < ${at(DAY_MS)})::int as prev24,
        count(*) filter (where created_at >= ${at(7 * DAY_MS)})::int as last7,
        count(*) filter (where created_at >= ${at(14 * DAY_MS)} and created_at < ${at(7 * DAY_MS)})::int as prev7
      from identity.installations
      where ${appIn(sql`app_id`, ids)} and created_at >= ${at(14 * DAY_MS)}
      group by app_id`),
    rows<{ app_id: string; day: string; installs: number }>(sql`
      select app_id, (created_at at time zone 'UTC')::date::text as day, count(*)::int as installs
      from identity.installations
      where ${appIn(sql`app_id`, ids)} and created_at >= ${`${firstDay}T00:00:00Z`}
      group by app_id, 2`),
  ]);
  return { totals, daily };
}

// Share of installs that were active again on day N after the install day.
// Current cohort: the last 7 install days whose day N is complete; previous: the 7 before.
async function retention(ids: string[], today: string) {
  const cohort = (n: number, shift: number) => ({ from: shiftDay(today, -(n + 7 + shift)), to: shiftDay(today, -(n + 1 + shift)) });
  const d1 = cohort(1, 0), d1p = cohort(1, 7), d7 = cohort(7, 0), d7p = cohort(7, 7);
  const back = (n: number) =>
    sql`exists (select 1 from identity.activity_days a
      where a.app_id = i.app_id and a.installation_id = i.id and a.day = (i.created_at at time zone 'UTC')::date + ${n}::int)`;
  const inCohort = (c: { from: string; to: string }) =>
    sql`(i.created_at at time zone 'UTC')::date between ${c.from}::date and ${c.to}::date`;

  return rows<{
    app_id: string;
    d1_size: number; d1_back: number; d1p_size: number; d1p_back: number;
    d7_size: number; d7_back: number; d7p_size: number; d7p_back: number;
  }>(sql`
    select i.app_id,
      count(*) filter (where ${inCohort(d1)})::int as d1_size,
      count(*) filter (where ${inCohort(d1)} and ${back(1)})::int as d1_back,
      count(*) filter (where ${inCohort(d1p)})::int as d1p_size,
      count(*) filter (where ${inCohort(d1p)} and ${back(1)})::int as d1p_back,
      count(*) filter (where ${inCohort(d7)})::int as d7_size,
      count(*) filter (where ${inCohort(d7)} and ${back(7)})::int as d7_back,
      count(*) filter (where ${inCohort(d7p)})::int as d7p_size,
      count(*) filter (where ${inCohort(d7p)} and ${back(7)})::int as d7p_back
    from identity.installations i
    where ${appIn(sql`i.app_id`, ids)} and i.created_at >= ${`${d7p.from}T00:00:00Z`}
    group by i.app_id`);
}

async function storeNumbers(ids: string[], now: Date) {
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const [subscribers, revenue] = await Promise.all([
    // Same rule as access: active, canceled until the end, grace period
    rows<{ app_id: string; subscribers: number }>(sql`
      select app_id, count(distinct user_id)::int as subscribers
      from billing.purchases
      where ${appIn(sql`app_id`, ids)} and not test
        and state in ('active', 'canceled', 'grace_period')
        and (state = 'grace_period' or expires_at is null or expires_at > ${now.toISOString()})
      group by app_id`),
    // Purchases and renewals at the price the store reported
    rows<{ app_id: string; currency: string; current: number; previous: number }>(sql`
      select e.app_id, p.currency,
        coalesce(sum(p.price_micros) filter (where e.occurred_at >= ${at(7 * DAY_MS)}), 0)::float8 / 1e6 as current,
        coalesce(sum(p.price_micros) filter (where e.occurred_at < ${at(7 * DAY_MS)}), 0)::float8 / 1e6 as previous
      from billing.purchase_events e
      join billing.purchases p on p.id = e.purchase_id
      where ${appIn(sql`e.app_id`, ids)} and e.kind in ('registered', 'renewed')
        and not p.test and p.price_micros is not null and p.currency is not null
        and e.occurred_at >= ${at(14 * DAY_MS)}
      group by e.app_id, p.currency`),
  ]);
  return { subscribers, revenue };
}

// Active installations of the last 7 days (and the 7 before) whose user's
// latest analytics decision at the end of the window was a grant
async function consentRates(ids: string[], today: string) {
  return rows<{ app_id: string; period: 'current' | 'previous'; active: number; granted: number }>(sql`
    select a.app_id, w.name as period, count(*)::int as active, count(*) filter (where c.granted)::int as granted
    from (values
      ('current', ${shiftDay(today, -7)}::date, ${today}::date),
      ('previous', ${shiftDay(today, -14)}::date, ${shiftDay(today, -7)}::date)
    ) as w(name, from_day, to_day)
    join lateral (
      select distinct app_id, installation_id from identity.activity_days
      where day >= w.from_day and day < w.to_day and ${appIn(sql`app_id`, ids)}
    ) a on true
    join identity.installations i on i.id = a.installation_id
    left join lateral (
      select granted from identity.consents
      where user_id = i.user_id and purpose = 'analytics' and created_at < w.to_day
      order by created_at desc limit 1
    ) c on true
    group by a.app_id, w.name`);
}

async function linkedAccounts(ids: string[], now: Date) {
  return rows<{ app_id: string; current: number; previous: number }>(sql`
    select u.app_id,
      count(*)::int as current,
      count(*) filter (where f.first_at < ${new Date(now.getTime() - 7 * DAY_MS).toISOString()})::int as previous
    from (
      select user_id, min(created_at) as first_at from identity.auth_identities
      where ${appIn(sql`app_id`, ids)} group by user_id
    ) f
    join identity.users u on u.id = f.user_id and u.status = 'active'
    group by u.app_id`);
}

async function attention(apps: AdminApp[], now: Date): Promise<Map<string, AttentionItem[]>> {
  const ids = apps.map((app) => app.id);
  const since = new Date(now.getTime() - DAY_MS);
  const [statuses, invalid, refused, grace] = await Promise.all([
    Promise.all(apps.map((app) => getSettingsStatus(app, now))),
    db
      .select({
        appId: events.appId,
        count: count(),
        event: sql<string | null>`mode() within group (order by ${events.name})`,
      })
      .from(events)
      // occurred_at narrows the scan to the current partitions
      .where(and(inArray(events.appId, ids), eq(events.valid, false), gte(events.receivedAt, since), gte(events.occurredAt, new Date(since.getTime() - 7 * DAY_MS))))
      .groupBy(events.appId),
    db
      .select({
        appId: rejectionCounts.appId,
        count: sql<number>`sum(${rejectionCounts.count})::int`,
        appVersion: sql<string | null>`max(${rejectionCounts.appVersion})`,
      })
      .from(rejectionCounts)
      .where(and(inArray(rejectionCounts.appId, ids), eq(rejectionCounts.reason, 'no_consent'), gte(rejectionCounts.day, utcDay(since))))
      .groupBy(rejectionCounts.appId),
    db
      .select({
        appId: purchases.appId,
        count: count(),
        product: sql<string | null>`mode() within group (order by ${purchases.productId})`,
      })
      .from(purchases)
      .where(and(inArray(purchases.appId, ids), eq(purchases.state, 'grace_period'), eq(purchases.test, false)))
      .groupBy(purchases.appId),
  ]);

  const byApp = new Map<string, AttentionItem[]>();
  apps.forEach((app, index) => {
    const items: AttentionItem[] = [];
    const tabs = Object.entries(statuses[index]!);
    // A disabled app is a decision, not a problem
    for (const [tab, state] of tabs) {
      if (state.status === 'error' && tab !== 'general') items.push({ kind: 'setting_error', severity: 'critical', tab, hint: state.hint });
    }
    const missing = tabs.filter(([, state]) => state.status === 'not_configured').map(([tab]) => tab);
    if (missing.length > 0) items.push({ kind: 'setup_incomplete', severity: 'warning', tabs: missing });

    const bad = invalid.find((row) => row.appId === app.id);
    if (bad) items.push({ kind: 'invalid_events', severity: 'warning', count: bad.count, event: bad.event });
    const no = refused.find((row) => row.appId === app.id);
    if (no && no.count > 0) items.push({ kind: 'refused_events', severity: 'warning', count: no.count, appVersion: no.appVersion });
    const late = grace.find((row) => row.appId === app.id);
    if (late) items.push({ kind: 'grace_period', severity: 'warning', count: late.count, product: late.product });
    byApp.set(app.id, items);
  });
  return byApp;
}

// Installations with analytics consent active in the last 30 minutes, per city
async function live(ids: string[], now: Date, minGroup: number) {
  const groups = await rows<{
    app_id: string; country: string | null; city: string | null; lat: number | null; lon: number | null; count: number;
  }>(sql`
    select app_id, country, city, lat, lon, count(*)::int as count
    from events.presence
    where ${appIn(sql`app_id`, ids)} and last_seen_at >= ${new Date(now.getTime() - PRESENCE_WINDOW_MS).toISOString()}
    group by app_id, country, city, lat, lon`);

  const shown = groups.filter((group) => group.count >= minGroup && group.lat !== null && group.lon !== null);
  return {
    total: groups.reduce((sum, group) => sum + group.count, 0),
    // Without a known city, or too small to show
    unplaced: groups.filter((group) => !shown.includes(group)).reduce((sum, group) => sum + group.count, 0),
    points: shown.map((group) => ({
      appId: group.app_id,
      country: group.country,
      city: group.city,
      lat: group.lat!,
      lon: group.lon!,
      count: group.count,
    })),
  };
}

export async function getOverview(
  apps: AdminApp[],
  options: { withRecentChanges: boolean; appSlug: string | null; viewerOnly: boolean },
  now: Date = new Date(),
) {
  const ids = apps.map((app) => app.id);
  const empty = { generatedAt: now, apps: [], live: { total: 0, unplaced: 0, points: [] }, recentChanges: null };
  if (ids.length === 0) return empty;

  const today = utcDay(now);
  const lastDay = shiftDay(today, -1);
  const firstDay = shiftDay(today, -SPARK_DAYS);
  const sparkDays = Array.from({ length: SPARK_DAYS }, (_, i) => shiftDay(firstDay, i));

  const [series, installs, cohorts, store, consent, linked, problems, livePoints, recent] = await Promise.all([
    activeSeries(ids, firstDay, lastDay),
    installCounts(ids, now, firstDay),
    retention(ids, today),
    storeNumbers(ids, now),
    consentRates(ids, today),
    linkedAccounts(ids, now),
    attention(apps, now),
    live(ids, now, options.viewerOnly ? VIEWER_MIN_GROUP : 1),
    options.withRecentChanges
      ? listAuditLog({ appSlug: options.appSlug ?? undefined, period: 'all', page: 1, limit: 10 }, now)
      : null,
  ]);

  const rowsOf = apps.map((app) => {
    const days = new Map(series.filter((row) => row.app_id === app.id).map((row) => [row.day, row]));
    const at = (day: string) => days.get(day) ?? { dau: 0, wau: 0, mau: 0 };
    const dauSpark = sparkDays.map((day) => at(day).dau);
    const installsByDay = new Map(installs.daily.filter((row) => row.app_id === app.id).map((row) => [row.day, row.installs]));
    const totals = installs.totals.find((row) => row.app_id === app.id);
    const cohort = cohorts.find((row) => row.app_id === app.id);
    const prevDay = shiftDay(lastDay, -7);
    const dau = average(dauSpark.slice(7));
    const dauPrevious = average(dauSpark.slice(0, 7));
    const consentNow = consent.find((row) => row.app_id === app.id && row.period === 'current');
    const consentBefore = consent.find((row) => row.app_id === app.id && row.period === 'previous');
    const links = linked.find((row) => row.app_id === app.id);

    const metrics: AppMetrics = {
      installs24h: { value: totals?.last24 ?? 0, previous: totals?.prev24 ?? 0 },
      installs7d: {
        value: totals?.last7 ?? 0,
        previous: totals?.prev7 ?? 0,
        spark: sparkDays.map((day) => installsByDay.get(day) ?? 0),
      },
      dau: { value: Math.round(dau), previous: Math.round(dauPrevious), spark: dauSpark },
      wau: { value: at(lastDay).wau, previous: at(prevDay).wau, spark: sparkDays.map((day) => at(day).wau) },
      mau: { value: at(lastDay).mau, previous: at(prevDay).mau, spark: sparkDays.map((day) => at(day).mau) },
      stickiness: {
        value: ratio(dau, at(lastDay).mau),
        previous: ratio(dauPrevious, at(prevDay).mau),
        spark: sparkDays.map((day) => ratio(at(day).dau, at(day).mau) ?? 0),
      },
      retentionD1: {
        value: ratio(cohort?.d1_back ?? 0, cohort?.d1_size ?? 0),
        previous: ratio(cohort?.d1p_back ?? 0, cohort?.d1p_size ?? 0),
        cohort: cohort?.d1_size ?? 0,
      },
      retentionD7: {
        value: ratio(cohort?.d7_back ?? 0, cohort?.d7_size ?? 0),
        previous: ratio(cohort?.d7p_back ?? 0, cohort?.d7p_size ?? 0),
        cohort: cohort?.d7_size ?? 0,
      },
      // The state a week ago is not kept, so no comparison yet
      subscribers: { value: store.subscribers.find((row) => row.app_id === app.id)?.subscribers ?? 0, previous: null },
      revenue7d: store.revenue
        .filter((row) => row.app_id === app.id)
        .map((row) => ({ currency: row.currency, value: row.current, previous: row.previous }))
        .sort((a, b) => b.value - a.value),
      consentRate: {
        value: consentNow ? ratio(consentNow.granted, consentNow.active) : null,
        previous: consentBefore ? ratio(consentBefore.granted, consentBefore.active) : null,
      },
      linkedAccounts: { value: links?.current ?? 0, previous: links?.previous ?? 0 },
    };

    return { ...app, metrics, attention: problems.get(app.id) ?? [] };
  });

  return {
    generatedAt: now,
    apps: rowsOf,
    live: {
      ...livePoints,
      points: livePoints.points.map(({ appId, ...point }) => ({ ...point, appSlug: apps.find((app) => app.id === appId)!.slug })),
    },
    recentChanges: recent?.entries ?? null,
  };
}
