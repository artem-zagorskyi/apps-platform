import { z } from 'zod';
import { platformEnum } from '../apps/schema.js';
import { lookupParameter, nameSchema, type ParameterSchema, valueProblem } from './parameters.js';

// The config document of an app: server values, rules, experiments and the
// holdout. Published as a whole; every publish is a new version.

// Buckets are 0.01% wide, so percents have at most two decimals
function percentSchema(max: number) {
  return z
    .number()
    .min(0)
    .max(max)
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-9, 'at most two decimals');
}

// 1, 1.2 or 1.2.3
const versionSchema = z.string().regex(/^\d+(\.\d+){0,2}$/, 'must look like 1.2.3');

const conditionFields = {
  platforms: z.array(z.enum(platformEnum.enumValues)).min(1).optional(),
  min_app_version: versionSchema.optional(),
  max_app_version: versionSchema.optional(),
  countries: z
    .array(z.string().regex(/^[A-Z]{2}$/, 'must be an ISO country code like DE'))
    .min(1)
    .optional(),
  // true: the user has a linked account; false: anonymous
  linked: z.boolean().optional(),
};

const ruleCondition = z
  .strictObject({ ...conditionFields, user_ids: z.array(z.uuid()).min(1).max(1000).optional() })
  .refine((c) => Object.keys(c).length > 0, 'a rule needs at least one condition');

const targetingSchema = z.strictObject({
  ...conditionFields,
  // Only users created after the experiment started
  new_users_only: z.boolean().optional(),
});

const parameterConfigSchema = z.strictObject({
  // Applies to everyone, above experiments: the kill switch
  force: z.unknown().optional(),
  // In order; the first matching rule wins
  rules: z.array(z.strictObject({ when: ruleCondition, value: z.unknown() })).max(100).optional(),
  // For everyone else
  value: z.unknown().optional(),
});

const experimentSchema = z.strictObject({
  description: z.string().min(1),
  status: z.enum(['draft', 'running', 'stopped']),
  layer: nameSchema,
  // Part of the layer's buckets, in percent
  traffic: z.strictObject({ from: percentSchema(100), to: percentSchema(100) }),
  targeting: targetingSchema.optional(),
  variants: z.record(
    nameSchema,
    z.strictObject({
      weight: z.number().int().min(1).max(99),
      values: z.record(nameSchema, z.unknown()),
    }),
  ),
  // Event the experiment is judged by
  primary_metric: nameSchema.optional(),
  // Testers: user id -> variant
  forced: z.record(z.uuid(), nameSchema).optional(),
  // Set by the server on publish; values in an uploaded file are ignored
  started_at: z.iso.datetime().optional(),
  stopped_at: z.iso.datetime().optional(),
});

export const configDocumentFormat = z.strictObject({
  format_version: z.literal(1),
  holdout: z.strictObject({ percent: percentSchema(50) }).default({ percent: 0 }),
  layers: z.array(nameSchema).min(1).default(['default']),
  parameters: z.record(nameSchema, parameterConfigSchema).default({}),
  experiments: z.record(nameSchema, experimentSchema).default({}),
});

export type ConfigDocument = z.infer<typeof configDocumentFormat>;
export type ParameterConfig = ConfigDocument['parameters'][string];
export type RuleCondition = NonNullable<ParameterConfig['rules']>[number]['when'];
export type Experiment = ConfigDocument['experiments'][string];
export type Targeting = NonNullable<Experiment['targeting']>;

// Own keys only: a name like "constructor" must not find Object.prototype
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

// JSON with sorted keys: equal documents give equal strings
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sameJson(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

// Compares dotted versions numerically (1.10 > 1.9). Missing parts are 0;
// suffixes like -beta are ignored.
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

// Parameters an experiment sets, sorted
export function experimentParameters(experiment: Experiment): string[] {
  const names = new Set<string>();
  for (const variant of Object.values(experiment.variants)) {
    for (const name of Object.keys(variant.values)) names.add(name);
  }
  return [...names].sort();
}

// Problems of the document on its own, checked against the app's
// declared parameters
export function documentErrors(document: ConfigDocument, schema: ParameterSchema | null): string[] {
  const errors: string[] = [];
  const declared: ParameterSchema = schema ?? { format_version: 1, parameters: {} };

  const checkValue = (path: string, name: string, value: unknown) => {
    const parameter = lookupParameter(declared, name);
    if (!parameter) {
      errors.push(`${path}: ${name} is not declared in the app's parameter schema`);
      return;
    }
    const problem = valueProblem(parameter, value);
    if (problem) errors.push(`${path}: ${problem}`);
  };

  const checkVersions = (
    path: string,
    c: { min_app_version?: string | undefined; max_app_version?: string | undefined },
  ) => {
    if (c.min_app_version && c.max_app_version && compareVersions(c.min_app_version, c.max_app_version) > 0) {
      errors.push(`${path}: min_app_version is above max_app_version`);
    }
  };

  if (new Set(document.layers).size !== document.layers.length) {
    errors.push('layers: a layer is listed twice');
  }

  for (const [name, config] of Object.entries(document.parameters)) {
    const path = `parameters.${name}`;
    if (!lookupParameter(declared, name)) {
      errors.push(`${path}: not declared in the app's parameter schema`);
      continue;
    }
    if (config.force !== undefined) checkValue(`${path}.force`, name, config.force);
    if (config.value !== undefined) checkValue(`${path}.value`, name, config.value);
    config.rules?.forEach((rule, i) => {
      checkValue(`${path}.rules.${i}.value`, name, rule.value);
      checkVersions(`${path}.rules.${i}.when`, rule.when);
    });
  }

  for (const [key, experiment] of Object.entries(document.experiments)) {
    const path = `experiments.${key}`;
    if (!document.layers.includes(experiment.layer)) {
      errors.push(`${path}.layer: ${experiment.layer} is not in layers`);
    }
    if (experiment.traffic.from >= experiment.traffic.to) {
      errors.push(`${path}.traffic: from must be below to`);
    }
    if (experiment.targeting) checkVersions(`${path}.targeting`, experiment.targeting);

    const variants = Object.entries(experiment.variants);
    if (variants.length < 2) errors.push(`${path}.variants: at least two are needed`);
    const total = variants.reduce((sum, [, v]) => sum + v.weight, 0);
    if (total !== 100) errors.push(`${path}.variants: weights add up to ${total}, not 100`);

    const parameters = experimentParameters(experiment);
    if (parameters.length === 0) errors.push(`${path}.variants: set at least one parameter`);
    for (const [variantKey, variant] of variants) {
      const variantPath = `${path}.variants.${variantKey}`;
      if (Object.keys(variant.values).length !== parameters.length) {
        errors.push(`${variantPath}: must set the same parameters as the other variants`);
      }
      for (const [name, value] of Object.entries(variant.values)) {
        checkValue(`${variantPath}.values.${name}`, name, value);
      }
    }

    for (const [userId, variantKey] of Object.entries(experiment.forced ?? {})) {
      if (!own(experiment.variants, variantKey)) {
        errors.push(`${path}.forced.${userId}: no variant ${variantKey}`);
      }
    }
  }

  // Running experiments must not compete for users or parameters
  const running = Object.entries(document.experiments).filter(([, e]) => e.status === 'running');
  const owners = new Map<string, string>();
  running.forEach(([key, experiment], i) => {
    for (const [otherKey, other] of running.slice(i + 1)) {
      const overlaps =
        experiment.traffic.from < other.traffic.to && other.traffic.from < experiment.traffic.to;
      if (other.layer === experiment.layer && overlaps) {
        errors.push(`experiments.${key}, experiments.${otherKey}: traffic overlaps in layer ${experiment.layer}`);
      }
    }
    for (const name of experimentParameters(experiment)) {
      const owner = owners.get(name);
      if (owner) errors.push(`parameters.${name}: set by running experiments ${owner} and ${key}`);
      else owners.set(name, key);
    }
  });

  return errors;
}

// Changes that would break experiments already started: who is in which
// variant must stay the same for the whole experiment
export function lifecycleErrors(previous: ConfigDocument | null, next: ConfigDocument): string[] {
  const errors: string[] = [];

  for (const [key, experiment] of Object.entries(next.experiments)) {
    const path = `experiments.${key}`;
    const before = previous ? own(previous.experiments, key) : undefined;

    if (!before || before.status === 'draft') {
      if (experiment.status === 'stopped') {
        errors.push(`${path}: never ran; remove it instead of stopping`);
      }
      continue;
    }

    if (before.status === 'stopped' && experiment.status !== 'stopped') {
      errors.push(`${path}: stopped experiments cannot run again; create a new one`);
    }
    if (before.status === 'running' && experiment.status === 'draft') {
      errors.push(`${path}: a started experiment cannot go back to draft; stop it`);
    }

    if (experiment.layer !== before.layer) {
      errors.push(`${path}.layer: cannot change after the start`);
    }
    if (!sameJson(experiment.variants, before.variants)) {
      errors.push(`${path}.variants: cannot change after the start`);
    }
    if (!sameJson(experiment.targeting ?? {}, before.targeting ?? {})) {
      errors.push(`${path}.targeting: cannot change after the start`);
    }
    if (experiment.primary_metric !== before.primary_metric) {
      errors.push(`${path}.primary_metric: cannot change after the start`);
    }
    if (experiment.traffic.from !== before.traffic.from) {
      errors.push(`${path}.traffic.from: cannot change after the start`);
    }

    // More traffic adds new users and keeps the assigned ones
    const stillRunning = before.status === 'running' && experiment.status === 'running';
    if (stillRunning && experiment.traffic.to < before.traffic.to) {
      errors.push(`${path}.traffic.to: can only grow while the experiment runs`);
    }
    if (!stillRunning && experiment.traffic.to !== before.traffic.to) {
      errors.push(`${path}.traffic.to: cannot change once stopped`);
    }
  }

  const prev = previous;
  if (prev) {
    for (const [key, before] of Object.entries(prev.experiments)) {
      if (before.status !== 'draft' && !own(next.experiments, key)) {
        errors.push(`experiments.${key}: started experiments stay in the config; stop it instead of removing`);
      }
    }

    // Moving users in or out of the holdout would silently change running experiments
    const keepsRunning = Object.entries(next.experiments).some(
      ([key, e]) => e.status === 'running' && own(prev.experiments, key)?.status === 'running',
    );
    if (keepsRunning && next.holdout.percent !== prev.holdout.percent) {
      errors.push('holdout.percent: cannot change while experiments are running');
    }
  }

  return errors;
}

// Sets started_at and stopped_at from the previous version and the publish
// time. Times in the uploaded file are ignored.
export function stampLifecycle(
  previous: ConfigDocument | null,
  next: ConfigDocument,
  now: Date,
): ConfigDocument {
  const at = now.toISOString();
  const experiments: Record<string, Experiment> = {};

  for (const [key, experiment] of Object.entries(next.experiments)) {
    const before = previous ? own(previous.experiments, key) : undefined;
    const stamped: Experiment = { ...experiment };
    delete stamped.started_at;
    delete stamped.stopped_at;

    if (experiment.status !== 'draft') {
      stamped.started_at = before?.started_at ?? at;
      if (experiment.status === 'stopped') stamped.stopped_at = before?.stopped_at ?? at;
    }
    experiments[key] = stamped;
  }

  return { ...next, experiments };
}