import { createHash } from 'node:crypto';
import type { Platform } from '../apps/schema.js';
import { compareVersions, type ConfigDocument, type Experiment, type RuleCondition } from './document.js';

// Computes one user's config values from the active config document.
// Pure: no database, no network.

const BUCKETS = 10_000;

export interface EvaluationContext {
  appId: string;
  userId: string;
  platform: Platform;
  appVersion: string;
  // From GeoIP; null when unknown, then country conditions never match
  country: string | null;
  // Has a linked account (Google, Apple)
  linked: boolean;
  userCreatedAt: Date;
}

export interface EvaluatedExperiment {
  key: string;
  variant: string;
  // Parameters whose value comes from this experiment; reading one is an exposure
  parameters: string[];
  // A tester's forced variant: not counted in results
  forced?: true;
}

export interface EvaluatedConfig {
  // 0 when nothing is published yet
  version: number;
  values: Record<string, unknown>;
  experiments: EvaluatedExperiment[];
}

// Stable bucket 0..9999 from the first 4 bytes of SHA-256
export function bucket(key: string): number {
  return createHash('sha256').update(key).digest().readUInt32BE(0) % BUCKETS;
}

// Percents have at most two decimals, so one bucket is 0.01%
function toBuckets(percent: number): number {
  return Math.round(percent * 100);
}

type SharedCondition = Pick<
  RuleCondition,
  'platforms' | 'min_app_version' | 'max_app_version' | 'countries' | 'linked'
>;

function matchesShared(c: SharedCondition, ctx: EvaluationContext): boolean {
  if (c.platforms && !c.platforms.includes(ctx.platform)) return false;
  if (c.min_app_version && compareVersions(ctx.appVersion, c.min_app_version) < 0) return false;
  if (c.max_app_version && compareVersions(ctx.appVersion, c.max_app_version) > 0) return false;
  if (c.countries && (ctx.country === null || !c.countries.includes(ctx.country))) return false;
  if (c.linked !== undefined && c.linked !== ctx.linked) return false;
  return true;
}

function matchesRule(c: RuleCondition, ctx: EvaluationContext): boolean {
  return matchesShared(c, ctx) && (!c.user_ids || c.user_ids.includes(ctx.userId));
}

function matchesTargeting(experiment: Experiment, ctx: EvaluationContext): boolean {
  const targeting = experiment.targeting;
  if (!targeting) return true;
  if (!matchesShared(targeting, ctx)) return false;
  if (targeting.new_users_only) {
    if (!experiment.started_at) return false;
    return ctx.userCreatedAt.getTime() >= new Date(experiment.started_at).getTime();
  }
  return true;
}

function inTraffic(experiment: Experiment, userId: string): boolean {
  const b = bucket(`layer:${experiment.layer}:${userId}`);
  return b >= toBuckets(experiment.traffic.from) && b < toBuckets(experiment.traffic.to);
}

// Variants in alphabetical order, each taking weight% of the buckets
function pickVariant(key: string, experiment: Experiment, userId: string): string | undefined {
  const b = bucket(`experiment:${key}:${userId}`);
  let upTo = 0;
  for (const name of Object.keys(experiment.variants).sort()) {
    upTo += (experiment.variants[name]?.weight ?? 0) * 100;
    if (b < upTo) return name;
  }
  return undefined;
}

export function evaluateConfig(
  active: { number: number; document: ConfigDocument } | null,
  ctx: EvaluationContext,
): EvaluatedConfig {
  if (!active) return { version: 0, values: {}, experiments: [] };
  const { document } = active;

  const holdout = toBuckets(document.holdout.percent);
  const inHoldout = holdout > 0 && bucket(`holdout:${ctx.appId}:${ctx.userId}`) < holdout;

  // 1. Experiments the user is in, and the values they set
  const assigned: { key: string; variant: string; forced: boolean }[] = [];
  const fromExperiment = new Map<string, { experiment: string; value: unknown }>();

  for (const key of Object.keys(document.experiments).sort()) {
    const experiment = document.experiments[key];
    if (!experiment || experiment.status !== 'running') continue;

    // Testers see their variant always: above holdout, traffic and targeting
    const forcedVariant =
      experiment.forced && Object.hasOwn(experiment.forced, ctx.userId)
        ? experiment.forced[ctx.userId]
        : undefined;

    let variant: string | undefined;
    let forced = false;
    if (forcedVariant !== undefined && Object.hasOwn(experiment.variants, forcedVariant)) {
      variant = forcedVariant;
      forced = true;
    } else if (!inHoldout && inTraffic(experiment, ctx.userId) && matchesTargeting(experiment, ctx)) {
      variant = pickVariant(key, experiment, ctx.userId);
    }
    if (variant === undefined) continue;

    assigned.push({ key, variant, forced });
    for (const [name, value] of Object.entries(experiment.variants[variant]?.values ?? {})) {
      fromExperiment.set(name, { experiment: key, value });
    }
  }

  // 2. Every parameter: force, then experiment, then the first matching rule, then value
  const values: Record<string, unknown> = {};
  const decidedBy = new Map<string, string[]>();
  const names = new Set([...Object.keys(document.parameters), ...fromExperiment.keys()]);

  for (const name of [...names].sort()) {
    const parameter = Object.hasOwn(document.parameters, name) ? document.parameters[name] : undefined;
    const experimentValue = fromExperiment.get(name);
    let value: unknown;

    if (parameter?.force !== undefined) {
      value = parameter.force;
    } else if (experimentValue) {
      value = experimentValue.value;
      decidedBy.set(experimentValue.experiment, [...(decidedBy.get(experimentValue.experiment) ?? []), name]);
    } else {
      const rule = parameter?.rules?.find((r) => matchesRule(r.when, ctx));
      value = rule ? rule.value : parameter?.value;
    }

    // Nothing set: the app uses its built-in default
    if (value !== undefined) values[name] = value;
  }

  // 3. An experiment whose parameters are all forced changes nothing for the user
  const experiments = assigned.flatMap(({ key, variant, forced }): EvaluatedExperiment[] => {
    const parameters = decidedBy.get(key);
    if (!parameters) return [];
    return [{ key, variant, parameters, ...(forced ? { forced: true as const } : {}) }];
  });

  return { version: active.number, values, experiments };
}