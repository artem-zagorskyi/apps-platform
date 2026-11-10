import { z } from 'zod';
import { platformEnum, type Platform } from '../apps/schema.js';

// Who a rule or an experiment applies to. Every condition field lives here:
// its format in the config document, how it is checked against a user and
// how the admin panel edits it. New fields (user traits) are added here only.

// What is known about the user when their config is computed
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

// 1, 1.2 or 1.2.3
const versionSchema = z.string().regex(/^\d+(\.\d+){0,2}$/, 'must look like 1.2.3');

// How the admin panel shows a field's input
export type ConditionKind = 'platforms' | 'version' | 'countries' | 'boolean' | 'user_ids';

export interface ConditionField<T> {
  label: string;
  kind: ConditionKind;
  // Format of the value in the config document
  schema: z.ZodType<T>;
  // Why the user does not meet the condition, or null when they do
  problem: (value: T, ctx: EvaluationContext) => string | null;
}

// Keeps T tied between the schema and the check
function field<T>(definition: ConditionField<T>): ConditionField<T> {
  return definition;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fields = Record<string, ConditionField<any>>;

const SHARED_FIELDS = {
  platforms: field({
    label: 'Platform',
    kind: 'platforms',
    schema: z.array(z.enum(platformEnum.enumValues)).min(1),
    problem: (platforms, ctx) =>
      platforms.includes(ctx.platform) ? null : `platform ${ctx.platform} is not ${platforms.join(' or ')}`,
  }),
  min_app_version: field({
    label: 'App version from',
    kind: 'version',
    schema: versionSchema,
    problem: (min, ctx) =>
      compareVersions(ctx.appVersion, min) < 0 ? `app version ${ctx.appVersion} is below ${min}` : null,
  }),
  max_app_version: field({
    label: 'App version up to',
    kind: 'version',
    schema: versionSchema,
    problem: (max, ctx) =>
      compareVersions(ctx.appVersion, max) > 0 ? `app version ${ctx.appVersion} is above ${max}` : null,
  }),
  countries: field({
    label: 'Country',
    kind: 'countries',
    schema: z.array(z.string().regex(/^[A-Z]{2}$/, 'must be an ISO country code like DE')).min(1),
    problem: (countries, ctx) => {
      if (ctx.country === null) return 'country is unknown';
      return countries.includes(ctx.country) ? null : `country ${ctx.country} is not ${countries.join(', ')}`;
    },
  }),
  // true: the user has a linked account; false: anonymous
  linked: field({
    label: 'Linked account',
    kind: 'boolean',
    schema: z.boolean(),
    problem: (linked, ctx) => {
      if (linked === ctx.linked) return null;
      return linked ? 'has no linked account' : 'has a linked account';
    },
  }),
};

// Conditions of parameter rules
export const RULE_FIELDS = {
  ...SHARED_FIELDS,
  user_ids: field({
    label: 'User IDs',
    kind: 'user_ids',
    schema: z.array(z.uuid()).min(1).max(1000),
    problem: (ids, ctx) => (ids.includes(ctx.userId) ? null : 'user is not in user_ids'),
  }),
};

// Targeting of experiments; new_users_only is checked by the experiment itself,
// since it depends on the start time
export const TARGETING_FIELDS = SHARED_FIELDS;

type Shape<F extends Fields> = { [K in keyof F]: z.ZodOptional<F[K]['schema']> };

// The fields as optional keys of a zod object
export function conditionShape<F extends Fields>(fields: F): Shape<F> {
  return Object.fromEntries(Object.entries(fields).map(([key, f]) => [key, f.schema.optional()])) as Shape<F>;
}

// Conditions the user does not meet, in field order; empty when all match
export function conditionProblems(fields: Fields, condition: object, ctx: EvaluationContext): string[] {
  const problems: string[] = [];
  for (const [key, f] of Object.entries(fields)) {
    const value = (condition as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const problem = f.problem(value, ctx);
    if (problem) problems.push(problem);
  }
  return problems;
}

export interface ConditionFieldInfo {
  key: string;
  label: string;
  kind: ConditionKind;
}

// For the rule and targeting editors of the admin panel
export function describeConditionFields(): { rules: ConditionFieldInfo[]; targeting: ConditionFieldInfo[] } {
  const describe = (fields: Fields) =>
    Object.entries(fields).map(([key, f]) => ({ key, label: f.label, kind: f.kind }));
  return {
    rules: describe(RULE_FIELDS),
    targeting: [...describe(TARGETING_FIELDS), { key: 'new_users_only', label: 'New users only', kind: 'boolean' }],
  };
}
