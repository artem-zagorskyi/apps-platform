import { createHash } from 'node:crypto';
import { conditionProblems, type EvaluationContext, RULE_FIELDS, TARGETING_FIELDS } from './conditions.js';
import type { ConfigDocument, Experiment, RuleCondition } from './document.js';

export type { EvaluationContext } from './conditions.js';

// Computes one user's config values from the active config document, and
// why each value is what it is. Pure: no database, no network.

const BUCKETS = 10_000;

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

// Why the user is or is not in an experiment. Buckets are 0..9999 (0.01% each).
export type ExperimentDecision =
  | { key: string; outcome: 'not_running'; status: 'draft' | 'stopped' }
  | { key: string; outcome: 'holdout' }
  | { key: string; outcome: 'outside_traffic'; bucket: number; from: number; to: number }
  | { key: string; outcome: 'not_targeted'; problems: string[] }
  // Weights not adding up to 100; a valid document never gets here
  | { key: string; outcome: 'no_variant' }
  // In the experiment. `parameters` lists those it decides; empty means force
  // overrides all of them and the app does not hear of the experiment.
  | { key: string; outcome: 'assigned'; variant: string; bucket: number; parameters: string[] }
  | { key: string; outcome: 'forced'; variant: string; parameters: string[] };

export type ParameterSource =
  | { kind: 'force' }
  | { kind: 'experiment'; experiment: string; variant: string }
  // Position in the parameter's rules, from 0
  | { kind: 'rule'; index: number }
  | { kind: 'value' }
  // Nothing set: the app uses its built-in default
  | { kind: 'default' };

export interface ParameterDecision {
  name: string;
  value: unknown;
  source: ParameterSource;
  // Rules tried before the decision, with why each did not match
  skippedRules: { index: number; problems: string[] }[];
}

export interface ConfigExplanation {
  version: number;
  holdout: { percent: number; bucket: number | null; inHoldout: boolean };
  experiments: ExperimentDecision[];
  parameters: ParameterDecision[];
}

// Stable bucket 0..9999 from the first 4 bytes of SHA-256
export function bucket(key: string): number {
  return createHash('sha256').update(key).digest().readUInt32BE(0) % BUCKETS;
}

// Percents have at most two decimals, so one bucket is 0.01%
function toBuckets(percent: number): number {
  return Math.round(percent * 100);
}

function ruleProblems(c: RuleCondition, ctx: EvaluationContext): string[] {
  return conditionProblems(RULE_FIELDS, c, ctx);
}

function targetingProblems(experiment: Experiment, ctx: EvaluationContext): string[] {
  const targeting = experiment.targeting;
  if (!targeting) return [];
  const problems = conditionProblems(TARGETING_FIELDS, targeting, ctx);
  if (targeting.new_users_only) {
    if (!experiment.started_at) {
      problems.push('new users only, and the experiment has no start time');
    } else if (ctx.userCreatedAt.getTime() < new Date(experiment.started_at).getTime()) {
      problems.push('new users only: the user was created before the start');
    }
  }
  return problems;
}

// Variants in alphabetical order, each taking weight% of the buckets
function pickVariant(
  key: string,
  experiment: Experiment,
  userId: string,
): { variant: string; bucket: number } | undefined {
  const b = bucket(`experiment:${key}:${userId}`);
  let upTo = 0;
  for (const name of Object.keys(experiment.variants).sort()) {
    upTo += (experiment.variants[name]?.weight ?? 0) * 100;
    if (b < upTo) return { variant: name, bucket: b };
  }
  return undefined;
}

// Every decision behind the user's config: the experiments, then each parameter
export function explainConfig(
  active: { number: number; document: ConfigDocument } | null,
  ctx: EvaluationContext,
): ConfigExplanation {
  if (!active) {
    return { version: 0, holdout: { percent: 0, bucket: null, inHoldout: false }, experiments: [], parameters: [] };
  }
  const { document } = active;

  const holdout = toBuckets(document.holdout.percent);
  const holdoutBucket = holdout > 0 ? bucket(`holdout:${ctx.appId}:${ctx.userId}`) : null;
  const inHoldout = holdoutBucket !== null && holdoutBucket < holdout;

  // 1. Experiments the user is in, and the values they set
  const experiments: ExperimentDecision[] = [];
  const fromExperiment = new Map<string, { experiment: string; variant: string; value: unknown }>();
  const decidedBy = new Map<string, string[]>();

  for (const key of Object.keys(document.experiments).sort()) {
    const experiment = document.experiments[key];
    if (!experiment) continue;
    if (experiment.status !== 'running') {
      experiments.push({ key, outcome: 'not_running', status: experiment.status });
      continue;
    }

    // Testers see their variant always: above holdout, traffic and targeting
    const forcedVariant =
      experiment.forced && Object.hasOwn(experiment.forced, ctx.userId) ? experiment.forced[ctx.userId] : undefined;

    let variant: string | undefined;
    if (forcedVariant !== undefined && Object.hasOwn(experiment.variants, forcedVariant)) {
      variant = forcedVariant;
      experiments.push({ key, outcome: 'forced', variant, parameters: [] });
    } else if (inHoldout) {
      experiments.push({ key, outcome: 'holdout' });
    } else {
      const layerBucket = bucket(`layer:${experiment.layer}:${ctx.userId}`);
      const problems = targetingProblems(experiment, ctx);
      if (layerBucket < toBuckets(experiment.traffic.from) || layerBucket >= toBuckets(experiment.traffic.to)) {
        experiments.push({
          key,
          outcome: 'outside_traffic',
          bucket: layerBucket,
          from: experiment.traffic.from,
          to: experiment.traffic.to,
        });
      } else if (problems.length > 0) {
        experiments.push({ key, outcome: 'not_targeted', problems });
      } else {
        const picked = pickVariant(key, experiment, ctx.userId);
        if (picked) {
          variant = picked.variant;
          experiments.push({ key, outcome: 'assigned', variant, bucket: picked.bucket, parameters: [] });
        } else {
          experiments.push({ key, outcome: 'no_variant' });
        }
      }
    }
    if (variant === undefined) continue;

    decidedBy.set(key, []);
    for (const [name, value] of Object.entries(experiment.variants[variant]?.values ?? {})) {
      fromExperiment.set(name, { experiment: key, variant, value });
    }
  }

  // 2. Every parameter: force, then experiment, then the first matching rule, then value
  const parameters: ParameterDecision[] = [];
  const names = new Set([...Object.keys(document.parameters), ...fromExperiment.keys()]);

  for (const name of [...names].sort()) {
    const parameter = Object.hasOwn(document.parameters, name) ? document.parameters[name] : undefined;
    const experimentValue = fromExperiment.get(name);
    const skippedRules: ParameterDecision['skippedRules'] = [];

    if (parameter?.force !== undefined) {
      parameters.push({ name, value: parameter.force, source: { kind: 'force' }, skippedRules });
      continue;
    }
    if (experimentValue) {
      decidedBy.get(experimentValue.experiment)?.push(name);
      parameters.push({
        name,
        value: experimentValue.value,
        source: { kind: 'experiment', experiment: experimentValue.experiment, variant: experimentValue.variant },
        skippedRules,
      });
      continue;
    }

    let decision: ParameterDecision | undefined;
    for (const [index, rule] of (parameter?.rules ?? []).entries()) {
      const problems = ruleProblems(rule.when, ctx);
      if (problems.length === 0) {
        decision = { name, value: rule.value, source: { kind: 'rule', index }, skippedRules };
        break;
      }
      skippedRules.push({ index, problems });
    }
    decision ??=
      parameter?.value !== undefined
        ? { name, value: parameter.value, source: { kind: 'value' }, skippedRules }
        : { name, value: undefined, source: { kind: 'default' }, skippedRules };
    parameters.push(decision);
  }

  // 3. The parameters each experiment decides; none means force overrides it
  for (const decision of experiments) {
    if (decision.outcome === 'assigned' || decision.outcome === 'forced') {
      decision.parameters = decidedBy.get(decision.key) ?? [];
    }
  }

  return {
    version: active.number,
    holdout: { percent: document.holdout.percent, bucket: holdoutBucket, inHoldout },
    experiments,
    parameters,
  };
}

// What the phone receives: values and the experiments that decide them
export function evaluateConfig(
  active: { number: number; document: ConfigDocument } | null,
  ctx: EvaluationContext,
): EvaluatedConfig {
  const explanation = explainConfig(active, ctx);

  const values: Record<string, unknown> = {};
  for (const p of explanation.parameters) {
    // Nothing set: the app uses its built-in default
    if (p.value !== undefined) values[p.name] = p.value;
  }

  const experiments = explanation.experiments.flatMap((d): EvaluatedExperiment[] => {
    if ((d.outcome !== 'assigned' && d.outcome !== 'forced') || d.parameters.length === 0) return [];
    return [{ key: d.key, variant: d.variant, parameters: d.parameters, ...(d.outcome === 'forced' ? { forced: true as const } : {}) }];
  });

  return { version: explanation.version, values, experiments };
}