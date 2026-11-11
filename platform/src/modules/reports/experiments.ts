import { type SQL, sql } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { type ConfigDocument, configDocumentFormat, type Experiment } from '../config/document.js';
import { type Comparison, compareConversion, sampleSizePerVariant, srmPValue } from './stats.js';

// Results of an experiment from exposures and its metrics.
// Reads the tables of the events, identity and config modules directly
// (the reports exception in docs/architecture.md).

const EXPOSURE_EVENT = 'experiment_exposed';

// Fewer users per variant: no comparison and no SRM verdict
export const MIN_USERS_PER_VARIANT = 8;
// A split this unlikely means a broken assignment or exposure tracking
export const SRM_THRESHOLD = 0.001;
// Share of quarantined users worth a warning
const QUARANTINE_WARNING = 0.01;
// Users created this long before their first exposure count as new
const NEW_USER_DAYS = 7;
// The smallest change the duration estimate plans for: +10% relative
const PLANNED_LIFT = 0.1;
const DAY_MS = 86_400_000;

// Built-in metrics: active on day N after the first exposure (UTC days)
const RETENTION = /^retention:d(\d+)$/;

export interface VariantResult {
  variant: string;
  // Configured share, in percent
  weight: number;
  // Exposed users, after merges are resolved and the quarantine is removed
  users: number;
  // Of them, reached the primary metric after their first exposure; null
  // without a primary metric. For retention only users exposed long enough
  // ago are counted, so the rate is over fewer users than `users`.
  conversions: number | null;
  rate: number | null;
  // Against control; null for control itself and with too little data
  comparison: Comparison | null;
}

export interface MetricCell {
  variant: string;
  // Users the metric is measured on
  users: number;
  conversions: number;
  rate: number | null;
  comparison: Comparison | null;
}

export interface MetricResult {
  metric: string;
  role: 'primary' | 'guardrail';
  lowerIsBetter: boolean;
  variants: MetricCell[];
  // Variants that are clearly worse than control on this metric
  worse: string[];
}

export interface CutGroup {
  // A platform, a country code, "Other", "new" or "returning"
  value: string;
  variants: MetricCell[];
}

export interface ExperimentResults {
  key: string;
  status: Experiment['status'];
  startedAt: Date;
  // stopped_at, or now while running
  until: Date;
  primaryMetric: string | null;
  control: string;
  variants: VariantResult[];
  // Primary metric and guardrails
  metrics: MetricResult[];
  // The primary metric by platform, country and new vs returning users
  cuts: { platform: CutGroup[]; country: CutGroup[]; newUsers: CutGroup[] } | null;
  // Cumulative exposed users per variant, one value per UTC day from the start
  exposures: { days: string[]; variants: Record<string, number[]> } | null;
  // Users per variant to see a +10% change, and how many days that takes in total
  estimate: { usersPerVariant: number; days: number; day: number } | null;
  // Users who saw more than one variant (mostly after signing into an account)
  quarantined: number;
  // Users who saw a variant missing from the config
  unknownVariant: number;
  srm: number | null;
  // false: the split does not match the weights; null: not enough data
  healthy: boolean | null;
  warnings: string[];
}

function parseDocument(json: unknown): ConfigDocument {
  return configDocumentFormat.parse(json);
}

// Experiments of the active config version
export async function loadExperiments(appId: string): Promise<ConfigDocument['experiments']> {
  const result = await db.execute(sql`
    select document from config.versions
    where app_id = ${appId}
    order by number desc
    limit 1
  `);
  const row = result.rows[0] as { document: unknown } | undefined;
  if (!row) throw new AppError(404, 'not_found', 'No config is published for this app');
  return parseDocument(row.document).experiments;
}

// The experiment as the active config version describes it
export async function loadExperiment(appId: string, key: string): Promise<Experiment> {
  const experiments = await loadExperiments(appId);
  const experiment = Object.hasOwn(experiments, key) ? experiments[key] : undefined;
  if (!experiment) throw new AppError(404, 'not_found', `No experiment ${key} in the active config`);
  return experiment;
}

// Exposed people of the experiment: user ids resolved to the account they
// were merged into, one unit per person with the variant, the time, the
// platform and the country of the first exposure, and whether they were new
function unitsCte(appId: string, key: string, from: Date, to: Date): SQL {
  return sql`
    chain as (
      select id as user_id, merged_into as account_id, 1 as depth
      from identity.users
      where app_id = ${appId} and merged_into is not null
      union all
      select chain.user_id, u.merged_into, chain.depth + 1
      from chain
      join identity.users u on u.id = chain.account_id
      where u.merged_into is not null and chain.depth < 10
    ),
    accounts as (
      select distinct on (user_id) user_id, account_id
      from chain
      order by user_id, depth desc
    ),
    exposures as (
      select coalesce(a.account_id, e.user_id) as unit, e.properties ->> 'variant' as variant,
             e.occurred_at, e.platform::text as platform, e.country
      from events.events e
      left join accounts a on a.user_id = e.user_id
      where e.app_id = ${appId}
        and e.name = ${EXPOSURE_EVENT}
        and e.valid
        and e.properties ->> 'experiment' = ${key}
        and e.occurred_at >= ${from}
        and e.occurred_at < ${to}
    ),
    first_seen as (
      select unit,
             case when count(distinct variant) > 1 then null else min(variant) end as variant,
             min(occurred_at) as first_exposure,
             (array_agg(platform order by occurred_at))[1] as platform,
             (array_agg(country order by occurred_at))[1] as country
      from exposures
      group by unit
    ),
    units as (
      select f.*,
             coalesce(u.created_at >= f.first_exposure - make_interval(days => ${NEW_USER_DAYS}), false) as is_new
      from first_seen f
      left join identity.users u on u.id = f.unit
    )`;
}

// Whether each unit reached the metric, and which units count for it
function scoredCte(appId: string, metric: string | null, from: Date, to: Date): SQL {
  const retention = metric?.match(RETENTION);
  if (retention) {
    const day = Number(retention[1]);
    // Active on the day: any installation of the person had an activity mark.
    // Only units whose day N is over before `to` are counted.
    return sql`
      scored as (
        select units.*, exists (
          select 1
          from identity.installations i
          join identity.activity_days d on d.installation_id = i.id and d.app_id = ${appId}
          left join accounts a on a.user_id = i.user_id
          where i.app_id = ${appId}
            and coalesce(a.account_id, i.user_id) = units.unit
            and d.day = (units.first_exposure at time zone 'UTC')::date + ${day}::int
        ) as converted
        from units
        where (units.first_exposure at time zone 'UTC')::date + ${day}::int
              < (${to}::timestamptz at time zone 'UTC')::date
      )`;
  }
  return sql`
    conversions as (
      select coalesce(a.account_id, m.user_id) as unit, m.occurred_at
      from events.events m
      left join accounts a on a.user_id = m.user_id
      where m.app_id = ${appId}
        and m.name = ${metric ?? ''}
        and m.valid
        and m.occurred_at >= ${from}
        and m.occurred_at < ${to}
    ),
    scored as (
      select units.*, exists (
        select 1 from conversions c
        where c.unit = units.unit and c.occurred_at >= units.first_exposure
      ) as converted
      from units
    )`;
}

interface ExposureRow {
  variant: string | null;
  day: string;
  users: number;
}

// New exposed units per variant and UTC day of their first exposure
async function countExposures(appId: string, key: string, from: Date, to: Date): Promise<ExposureRow[]> {
  const result = await db.execute(sql`
    with recursive ${unitsCte(appId, key, from, to)}
    select variant, to_char((first_exposure at time zone 'UTC')::date, 'YYYY-MM-DD') as day, count(*)::int as users
    from units
    group by 1, 2
    order by 2
  `);
  return result.rows as unknown as ExposureRow[];
}

type Cut = 'all' | 'platform' | 'country' | 'newUsers';

interface MetricRow {
  cut: Cut;
  variant: string | null;
  value: string | null;
  users: number;
  converted: number;
}

// Users and conversions per variant; with cuts, also per platform, country and new vs returning
async function countMetric(
  appId: string,
  key: string,
  metric: string | null,
  from: Date,
  to: Date,
  withCuts: boolean,
): Promise<MetricRow[]> {
  const ctes = sql`with recursive ${unitsCte(appId, key, from, to)}, ${scoredCte(appId, metric, from, to)}`;
  if (!withCuts) {
    const result = await db.execute(sql`
      ${ctes}
      select variant, 'all' as cut, null as value, count(*)::int as users, count(*) filter (where converted)::int as converted
      from scored
      where variant is not null
      group by variant
    `);
    return result.rows as unknown as MetricRow[];
  }
  const result = await db.execute(sql`
    ${ctes}
    select variant,
           case
             when grouping(platform) = 0 then 'platform'
             when grouping(country) = 0 then 'country'
             when grouping(is_new) = 0 then 'newUsers'
             else 'all'
           end as cut,
           coalesce(platform, country, case when is_new then 'new' when not is_new then 'returning' end) as value,
           count(*)::int as users,
           count(*) filter (where converted)::int as converted
    from scored
    where variant is not null
    group by grouping sets ((variant), (variant, platform), (variant, country), (variant, is_new))
  `);
  return result.rows as unknown as MetricRow[];
}

function cellsOf(
  names: string[],
  control: string,
  counts: Map<string, { users: number; converted: number }>,
  compare: boolean,
): MetricCell[] {
  const countOf = (name: string) => counts.get(name) ?? { users: 0, converted: 0 };
  const base = countOf(control);
  const enough = names.every((name) => countOf(name).users >= MIN_USERS_PER_VARIANT);
  return names.map((name) => {
    const c = countOf(name);
    return {
      variant: name,
      users: c.users,
      conversions: c.converted,
      rate: c.users === 0 ? null : c.converted / c.users,
      comparison:
        compare && enough && name !== control
          ? compareConversion({ users: base.users, conversions: base.converted }, { users: c.users, conversions: c.converted })
          : null,
    };
  });
}

// The primary metric per value of one cut. Countries too small to compare
// on their own are merged into "Other".
function cutGroups(rows: MetricRow[], cut: Cut, names: string[], control: string): CutGroup[] {
  const byValue = new Map<string, Map<string, { users: number; converted: number }>>();
  for (const row of rows.filter((r) => r.cut === cut && r.variant !== null)) {
    const value = row.value ?? 'unknown';
    const counts = byValue.get(value) ?? new Map();
    counts.set(row.variant!, { users: row.users, converted: row.converted });
    byValue.set(value, counts);
  }

  if (cut === 'country') {
    const other = new Map<string, { users: number; converted: number }>();
    for (const [value, counts] of [...byValue]) {
      const small = value === 'unknown' || names.some((name) => (counts.get(name)?.users ?? 0) < MIN_USERS_PER_VARIANT);
      if (!small) continue;
      for (const [name, c] of counts) {
        const sum = other.get(name) ?? { users: 0, converted: 0 };
        other.set(name, { users: sum.users + c.users, converted: sum.converted + c.converted });
      }
      byValue.delete(value);
    }
    if (other.size) byValue.set('Other', other);
  }

  const total = (counts: Map<string, { users: number }>) => [...counts.values()].reduce((sum, c) => sum + c.users, 0);
  return [...byValue]
    .sort(([a, x], [b, y]) => Number(a === 'Other') - Number(b === 'Other') || total(y) - total(x) || a.localeCompare(b))
    .map(([value, counts]) => ({ value, variants: cellsOf(names, control, counts, true) }));
}

// Variants clearly on the wrong side of control: the whole interval is bad
function worseVariants(cells: MetricCell[], lowerIsBetter: boolean): string[] {
  return cells
    .filter((cell) => cell.comparison && (lowerIsBetter ? cell.comparison.low > 0 : cell.comparison.high < 0))
    .map((cell) => cell.variant);
}

// Cumulative users per variant for every UTC day from the start to `until`
function cumulative(rows: ExposureRow[], names: string[], startedAt: Date, until: Date) {
  const days: string[] = [];
  const last = new Date(Math.max(until.getTime() - 1, startedAt.getTime()));
  for (let at = Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), startedAt.getUTCDate()); at <= last.getTime(); at += DAY_MS) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  const variants: Record<string, number[]> = {};
  for (const name of names) {
    let sum = 0;
    variants[name] = days.map((day) => {
      sum += rows.find((row) => row.variant === name && row.day === day)?.users ?? 0;
      return sum;
    });
  }
  return { days, variants };
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export async function experimentResults(
  appId: string,
  key: string,
  experiment: Experiment,
  // details: false leaves out cuts and the daily series (for summaries)
  options: { control?: string; now?: Date; details?: boolean } = {},
): Promise<ExperimentResults> {
  if (!experiment.started_at) {
    throw new AppError(400, 'not_started', `Experiment ${key} has not started`);
  }
  const startedAt = new Date(experiment.started_at);
  const until = experiment.stopped_at ? new Date(experiment.stopped_at) : (options.now ?? new Date());
  const details = options.details ?? true;

  const names = Object.keys(experiment.variants).sort();
  const control = options.control ?? (names.includes('control') ? 'control' : names[0]);
  if (control === undefined || !names.includes(control)) {
    throw new AppError(400, 'unknown_variant', `Experiment ${key} has no variant ${options.control}`);
  }
  const metric = experiment.primary_metric ?? null;
  const guardrails = experiment.guardrail_metrics ?? [];

  const [exposureRows, primaryRows, ...guardrailRows] = await Promise.all([
    countExposures(appId, key, startedAt, until),
    countMetric(appId, key, metric, startedAt, until, details && metric !== null),
    ...guardrails.map((g) => countMetric(appId, key, g.metric, startedAt, until, false)),
  ]);

  // Who was exposed, from the exposures alone
  const exposed = new Map<string, number>();
  let quarantined = 0;
  let unknownVariant = 0;
  for (const row of exposureRows) {
    if (row.variant === null) quarantined += row.users;
    else if (names.includes(row.variant)) exposed.set(row.variant, (exposed.get(row.variant) ?? 0) + row.users);
    else unknownVariant += row.users;
  }
  const usersOf = (name: string) => exposed.get(name) ?? 0;
  const enough = names.every((name) => usersOf(name) >= MIN_USERS_PER_VARIANT);
  const srm = enough
    ? srmPValue(
        names.map(usersOf),
        names.map((name) => experiment.variants[name]?.weight ?? 0),
      )
    : null;
  const healthy = srm === null ? null : srm >= SRM_THRESHOLD;

  const totals = (rows: MetricRow[]) =>
    new Map(rows.filter((row) => row.cut === 'all' && row.variant !== null).map((row) => [row.variant!, row]));

  const primaryCells = metric === null ? null : cellsOf(names, control, totals(primaryRows), enough);
  const metrics: MetricResult[] = [];
  if (primaryCells) {
    metrics.push({ metric: metric!, role: 'primary', lowerIsBetter: false, variants: primaryCells, worse: worseVariants(primaryCells, false) });
  }
  guardrails.forEach((guardrail, i) => {
    const cells = cellsOf(names, control, totals(guardrailRows[i] ?? []), enough);
    const lowerIsBetter = guardrail.lower_is_better ?? false;
    metrics.push({ metric: guardrail.metric, role: 'guardrail', lowerIsBetter, variants: cells, worse: worseVariants(cells, lowerIsBetter) });
  });

  const variants = names.map((name): VariantResult => {
    const cell = primaryCells?.find((c) => c.variant === name);
    return {
      variant: name,
      weight: experiment.variants[name]?.weight ?? 0,
      users: usersOf(name),
      conversions: cell ? cell.conversions : null,
      rate: cell ? cell.rate : null,
      comparison: cell ? cell.comparison : null,
    };
  });

  const cuts =
    details && metric !== null
      ? {
          platform: cutGroups(primaryRows, 'platform', names, control),
          country: cutGroups(primaryRows, 'country', names, control),
          newUsers: cutGroups(primaryRows, 'newUsers', names, control),
        }
      : null;

  // How long until a +10% change in the primary metric can be seen
  const day = Math.max(1, Math.ceil((until.getTime() - startedAt.getTime()) / DAY_MS));
  const controlRate = primaryCells?.find((c) => c.variant === control)?.rate ?? null;
  const usersPerVariant = controlRate === null ? null : sampleSizePerVariant(controlRate, PLANNED_LIFT);
  const dailyPerVariant = Math.min(...names.map((name) => usersOf(name) / day));
  const retentionDays = Number(metric?.match(RETENTION)?.[1] ?? 0);
  const estimate =
    usersPerVariant !== null && dailyPerVariant > 0
      ? { usersPerVariant, days: Math.ceil(usersPerVariant / dailyPerVariant) + retentionDays, day }
      : null;

  const warnings: string[] = [];
  const total = names.reduce((sum, name) => sum + usersOf(name), 0) + quarantined;
  if (!enough) {
    warnings.push(`Not enough data: every variant needs at least ${MIN_USERS_PER_VARIANT} users`);
  }
  if (healthy === false) {
    warnings.push(
      `Sample ratio mismatch (p = ${srm?.toPrecision(2)}): users did not split by the weights, do not trust these results`,
    );
  }
  if (total > 0 && quarantined / total >= QUARANTINE_WARNING) {
    warnings.push(`${percent(quarantined / total)} of users saw more than one variant and are left out`);
  }
  if (unknownVariant > 0) {
    warnings.push(`${unknownVariant} users saw a variant that is not in the config`);
  }
  if (metric === null) {
    warnings.push('No primary_metric: only exposures are counted');
  } else if (enough && primaryCells?.find((c) => c.variant === control)?.conversions === 0) {
    warnings.push(`No conversions in ${control} yet: nothing to compare against`);
  }
  for (const m of metrics) {
    const days = m.metric.match(RETENTION)?.[1];
    if (days) warnings.push(`${m.metric} counts only users exposed more than ${days} day${days === '1' ? '' : 's'} ago`);
  }
  if (options.control === undefined && control !== 'control') {
    warnings.push(`No variant named control: comparing against ${control}`);
  }

  return {
    key,
    status: experiment.status,
    startedAt,
    until,
    primaryMetric: metric,
    control,
    variants,
    metrics,
    cuts,
    exposures: details ? cumulative(exposureRows, names, startedAt, until) : null,
    estimate,
    quarantined,
    unknownVariant,
    srm,
    healthy,
    warnings,
  };
}

export interface ExperimentSummary {
  key: string;
  status: Experiment['status'];
  users: number;
  healthy: boolean | null;
  // The variant most likely to beat control on the primary metric
  leader: { variant: string; lift: number; low: number; high: number; chanceToWin: number } | null;
  // Guardrails a variant clearly hurts: "retention:d1 in trial_first"
  hurt: { metric: string; variant: string }[];
  estimate: ExperimentResults['estimate'];
}

// One line per started experiment of the active config, for the experiments list
export async function experimentsSummary(appId: string, now: Date = new Date()): Promise<ExperimentSummary[]> {
  const experiments = await loadExperiments(appId);
  const started = Object.entries(experiments)
    .filter(([, e]) => e.started_at)
    .sort(([a], [b]) => a.localeCompare(b));

  return Promise.all(
    started.map(async ([key, experiment]) => {
      const results = await experimentResults(appId, key, experiment, { now, details: false });
      const best = results.variants
        .filter((v) => v.comparison)
        .sort((a, b) => b.comparison!.chanceToWin - a.comparison!.chanceToWin)[0];
      return {
        key,
        status: results.status,
        users: results.variants.reduce((sum, v) => sum + v.users, 0),
        healthy: results.healthy,
        leader: best ? { variant: best.variant, ...best.comparison! } : null,
        hurt: results.metrics
          .filter((m) => m.role === 'guardrail')
          .flatMap((m) => m.worse.map((variant) => ({ metric: m.metric, variant }))),
        estimate: results.estimate,
      };
    }),
  );
}
