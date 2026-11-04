import { sql } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { configDocumentFormat, type Experiment } from '../config/document.js';
import { type Comparison, compareConversion, srmPValue } from './stats.js';

// Results of an experiment from exposures and the primary metric event.
// Reads the tables of the events, identity and config modules directly
// (the reports exception in docs/architecture.md).

const EXPOSURE_EVENT = 'experiment_exposed';

// Fewer users per variant: no comparison and no SRM verdict
export const MIN_USERS_PER_VARIANT = 8;
// A split this unlikely means a broken assignment or exposure tracking
export const SRM_THRESHOLD = 0.001;
// Share of quarantined users worth a warning
const QUARANTINE_WARNING = 0.01;

export interface VariantResult {
  variant: string;
  // Configured share, in percent
  weight: number;
  // Exposed users, after merges are resolved and the quarantine is removed
  users: number;
  // Of them, did the primary metric event after their first exposure;
  // null without a primary metric
  conversions: number | null;
  rate: number | null;
  // Against control; null for control itself and with too little data
  comparison: Comparison | null;
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
  // Users who saw more than one variant (mostly after signing into an account)
  quarantined: number;
  // Users who saw a variant missing from the config
  unknownVariant: number;
  srm: number | null;
  // false: the split does not match the weights; null: not enough data
  healthy: boolean | null;
  warnings: string[];
}

// The experiment as the active config version describes it
export async function loadExperiment(appId: string, key: string): Promise<Experiment> {
  const result = await db.execute(sql`
    select document from config.versions
    where app_id = ${appId}
    order by number desc
    limit 1
  `);
  const row = result.rows[0] as { document: unknown } | undefined;
  if (!row) throw new AppError(404, 'not_found', 'No config is published for this app');

  const document = configDocumentFormat.parse(row.document);
  const experiment = Object.hasOwn(document.experiments, key) ? document.experiments[key] : undefined;
  if (!experiment) throw new AppError(404, 'not_found', `No experiment ${key} in the active config`);
  return experiment;
}

interface UnitCount {
  // null: users quarantined for seeing more than one variant
  variant: string | null;
  users: number;
  converted: number;
}

// One query: user ids resolved to the account they were merged into, one unit
// per person, the first exposure, a conversion only at or after it
async function countUnits(
  appId: string,
  key: string,
  metric: string | null,
  from: Date,
  to: Date,
): Promise<UnitCount[]> {
  const result = await db.execute(sql`
    with recursive chain as (
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
      select coalesce(a.account_id, e.user_id) as unit, e.properties ->> 'variant' as variant, e.occurred_at
      from events.events e
      left join accounts a on a.user_id = e.user_id
      where e.app_id = ${appId}
        and e.name = ${EXPOSURE_EVENT}
        and e.valid
        and e.properties ->> 'experiment' = ${key}
        and e.occurred_at >= ${from}
        and e.occurred_at < ${to}
    ),
    units as (
      select unit,
             case when count(distinct variant) > 1 then null else min(variant) end as variant,
             min(occurred_at) as first_exposure
      from exposures
      group by unit
    ),
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
      select units.variant,
             exists (
               select 1 from conversions c
               where c.unit = units.unit and c.occurred_at >= units.first_exposure
             ) as converted
      from units
    )
    select variant, count(*)::int as users, count(*) filter (where converted)::int as converted
    from scored
    group by variant
  `);
  return result.rows as unknown as UnitCount[];
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export async function experimentResults(
  appId: string,
  key: string,
  experiment: Experiment,
  options: { control?: string; now?: Date } = {},
): Promise<ExperimentResults> {
  if (!experiment.started_at) {
    throw new AppError(400, 'not_started', `Experiment ${key} has not started`);
  }
  const startedAt = new Date(experiment.started_at);
  const until = experiment.stopped_at ? new Date(experiment.stopped_at) : (options.now ?? new Date());

  const names = Object.keys(experiment.variants).sort();
  const control = options.control ?? (names.includes('control') ? 'control' : names[0]);
  if (control === undefined || !names.includes(control)) {
    throw new AppError(400, 'unknown_variant', `Experiment ${key} has no variant ${options.control}`);
  }
  const metric = experiment.primary_metric ?? null;

  const counts = new Map<string, { users: number; converted: number }>();
  let quarantined = 0;
  let unknownVariant = 0;
  for (const row of await countUnits(appId, key, metric, startedAt, until)) {
    if (row.variant === null) quarantined += row.users;
    else if (names.includes(row.variant)) counts.set(row.variant, { users: row.users, converted: row.converted });
    else unknownVariant += row.users;
  }

  const countOf = (name: string) => counts.get(name) ?? { users: 0, converted: 0 };
  const enough = names.every((name) => countOf(name).users >= MIN_USERS_PER_VARIANT);
  const srm = enough
    ? srmPValue(
        names.map((name) => countOf(name).users),
        names.map((name) => experiment.variants[name]?.weight ?? 0),
      )
    : null;
  const healthy = srm === null ? null : srm >= SRM_THRESHOLD;

  const base = countOf(control);
  const variants = names.map((name): VariantResult => {
    const c = countOf(name);
    const compare = metric !== null && enough && name !== control;
    return {
      variant: name,
      weight: experiment.variants[name]?.weight ?? 0,
      users: c.users,
      conversions: metric === null ? null : c.converted,
      rate: metric === null || c.users === 0 ? null : c.converted / c.users,
      comparison: compare
        ? compareConversion(
            { users: base.users, conversions: base.converted },
            { users: c.users, conversions: c.converted },
          )
        : null,
    };
  });

  const warnings: string[] = [];
  const total = names.reduce((sum, name) => sum + countOf(name).users, 0) + quarantined;
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
  } else if (enough && base.converted === 0) {
    warnings.push(`No conversions in ${control} yet: nothing to compare against`);
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
    quarantined,
    unknownVariant,
    srm,
    healthy,
    warnings,
  };
}