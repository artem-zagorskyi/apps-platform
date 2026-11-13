import { z } from 'zod';
import { platformEnum, type Platform } from '../apps/schema.js';

// Who a rule or an experiment applies to. Every condition field lives here:
// its format in the config document, how it is checked against a user and
// how the admin panel edits it. New fields (user traits) are added here only.

export const ENGAGEMENT_LEVELS = ['new', 'returning', 'core', 'casual'] as const;
export const SUBSCRIPTION_STATUSES = [
  'none',
  'active',
  'grace_period',
  'on_hold',
  'paused',
  'canceled',
  'expired',
  'refunded',
] as const;
export const SIGN_IN_METHODS = ['anonymous', 'google', 'apple'] as const;

// What the platform knows about the person's behaviour and purchases.
// Used only with personalization consent; the device fields also need
// analytics consent on the device, otherwise they are null.
export interface PersonalTraits {
  daysSinceInstall: number;
  // Days between the previous visit and today; null on the first day
  daysSinceLastVisit: number | null;
  activeDays7: number;
  activeDays28: number;
  // Days in a row up to today
  streakDays: number;
  engagement: (typeof ENGAGEMENT_LEVELS)[number];
  subscription: (typeof SUBSCRIPTION_STATUSES)[number];
  // Entitlements the person has access to now
  entitlements: string[];
  hasPurchased: boolean;
  daysSinceSubscriptionEnded: number | null;
  // Two-letter language of the device, lower case
  language: string | null;
  notificationsEnabled: boolean | null;
  lowMemoryDevice: boolean | null;
  // 0..23 in the device's time zone
  localHour: number | null;
  installSource: string | null;
}

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
  // OS version of the device; missing or null when unknown
  osVersion?: string | null;
  // Linked sign-in providers; missing means none known
  providers?: string[];
  // null or missing: no personalization consent, trait conditions never match
  traits?: PersonalTraits | null;
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
export type ConditionKind =
  | 'platforms'
  | 'version'
  | 'countries'
  | 'boolean'
  | 'user_ids'
  // { min?, max? } whole numbers
  | 'range'
  // Some of a fixed list of values
  | 'choice'
  // Any of a few free values: entitlements, languages
  | 'tags';

// Where the admin panel lists a field
export type ConditionGroup = 'user' | 'activity' | 'purchases' | 'device';

// What a field needs to ever match: personalization consent, and for device
// fields also analytics consent on the device
export type ConditionNeeds = 'personalization' | 'personalization_analytics';

export interface ConditionField<T> {
  label: string;
  kind: ConditionKind;
  group?: ConditionGroup;
  needs?: ConditionNeeds;
  // For choice
  options?: readonly string[];
  // For range
  bounds?: { min: number; max: number };
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
  // How the person signed in: anonymous, or any of the linked providers
  sign_in: field({
    label: 'Signed in with',
    kind: 'choice',
    options: SIGN_IN_METHODS,
    schema: z.array(z.enum(SIGN_IN_METHODS)).min(1),
    problem: (methods, ctx) => {
      const providers = ctx.providers ?? [];
      const own = providers.length ? providers : ['anonymous'];
      return methods.some((method) => own.includes(method)) ? null : `signed in with ${own.join(', ')}, not ${methods.join(' or ')}`;
    },
  }),
  min_os_version: field({
    label: 'OS version from',
    kind: 'version',
    group: 'device',
    schema: versionSchema,
    problem: (min, ctx) => {
      if (!ctx.osVersion) return 'OS version unknown';
      return compareVersions(ctx.osVersion, min) < 0 ? `OS version ${ctx.osVersion} is below ${min}` : null;
    },
  }),
  max_os_version: field({
    label: 'OS version up to',
    kind: 'version',
    group: 'device',
    schema: versionSchema,
    problem: (max, ctx) => {
      if (!ctx.osVersion) return 'OS version unknown';
      return compareVersions(ctx.osVersion, max) > 0 ? `OS version ${ctx.osVersion} is above ${max}` : null;
    },
  }),
};

// { min?, max? }: at least one bound, min not above max unless `wraps` (hours over midnight)
function rangeSchema(bounds: { min: number; max: number }, wraps = false) {
  const value = z.number().int().min(bounds.min).max(bounds.max);
  return z
    .strictObject({ min: value.optional(), max: value.optional() })
    .refine((r) => r.min !== undefined || r.max !== undefined, 'set min, max or both')
    .refine((r) => wraps || r.min === undefined || r.max === undefined || r.min <= r.max, 'min is above max');
}

function inRange(value: number, range: { min?: number | undefined; max?: number | undefined }, wraps = false): boolean {
  const { min, max } = range;
  // 22..6 means from 22:00 over midnight to 6:59
  if (wraps && min !== undefined && max !== undefined && min > max) return value >= min || value <= max;
  return (min === undefined || value >= min) && (max === undefined || value <= max);
}

function rangeText(range: { min?: number | undefined; max?: number | undefined }): string {
  if (range.min !== undefined && range.max !== undefined) return `${range.min}–${range.max}`;
  return range.min !== undefined ? `${range.min} or more` : `${range.max} or less`;
}

const NO_CONSENT = 'no personalization consent';

// A condition on a personal trait: never matches without consent
function trait<T>(
  definition: Omit<ConditionField<T>, 'problem'> & {
    problem: (value: T, traits: PersonalTraits) => string | null;
  },
): ConditionField<T> {
  return {
    ...definition,
    needs: definition.needs ?? 'personalization',
    problem: (value, ctx) => (ctx.traits ? definition.problem(value, ctx.traits) : NO_CONSENT),
  };
}

function rangeTrait(label: string, read: (t: PersonalTraits) => number | null, bounds: { min: number; max: number }, unknown: string) {
  return trait({
    label,
    kind: 'range',
    group: 'activity',
    bounds,
    schema: rangeSchema(bounds),
    problem: (range, traits) => {
      const value = read(traits);
      if (value === null) return unknown;
      return inRange(value, range) ? null : `${label.toLowerCase()} ${value} is not ${rangeText(range)}`;
    },
  });
}

const tagSchema = (pattern: RegExp, message: string) => z.array(z.string().regex(pattern, message)).min(1).max(50);

// Behaviour, purchases and the device: the personal traits
const TRAIT_FIELDS = {
  days_since_install: rangeTrait('Days since install', (t) => t.daysSinceInstall, { min: 0, max: 3650 }, 'install day unknown'),
  days_since_last_visit: rangeTrait(
    'Days away before this visit',
    (t) => t.daysSinceLastVisit,
    { min: 0, max: 3650 },
    'first visit: no earlier visit',
  ),
  active_days_7: rangeTrait('Active days of the last 7', (t) => t.activeDays7, { min: 0, max: 7 }, 'activity unknown'),
  active_days_28: rangeTrait('Active days of the last 28', (t) => t.activeDays28, { min: 0, max: 28 }, 'activity unknown'),
  streak_days: rangeTrait('Days in a row', (t) => t.streakDays, { min: 0, max: 3650 }, 'activity unknown'),
  engagement: trait({
    label: 'Engagement',
    kind: 'choice',
    group: 'activity',
    options: ENGAGEMENT_LEVELS,
    schema: z.array(z.enum(ENGAGEMENT_LEVELS)).min(1),
    problem: (levels, t) => (levels.includes(t.engagement) ? null : `engagement ${t.engagement} is not ${levels.join(' or ')}`),
  }),
  subscription: trait({
    label: 'Subscription',
    kind: 'choice',
    group: 'purchases',
    options: SUBSCRIPTION_STATUSES,
    schema: z.array(z.enum(SUBSCRIPTION_STATUSES)).min(1),
    problem: (statuses, t) =>
      statuses.includes(t.subscription) ? null : `subscription ${t.subscription} is not ${statuses.join(' or ')}`,
  }),
  entitlements: trait({
    label: 'Has entitlement',
    kind: 'tags',
    group: 'purchases',
    schema: tagSchema(/^[a-z][a-z0-9_]*$/, 'must be an entitlement like premium'),
    problem: (wanted, t) =>
      wanted.some((name) => t.entitlements.includes(name)) ? null : `has none of ${wanted.join(', ')}`,
  }),
  has_purchased: trait({
    label: 'Ever purchased',
    kind: 'boolean',
    group: 'purchases',
    schema: z.boolean(),
    problem: (wanted, t) => (wanted === t.hasPurchased ? null : wanted ? 'never purchased' : 'has purchased'),
  }),
  days_since_subscription_ended: {
    ...rangeTrait(
      'Days since subscription ended',
      (t) => t.daysSinceSubscriptionEnded,
      { min: 0, max: 3650 },
      'no ended subscription',
    ),
    group: 'purchases' as const,
  },
  languages: trait({
    label: 'Device language',
    kind: 'tags',
    group: 'device',
    needs: 'personalization_analytics',
    schema: tagSchema(/^[a-z]{2}$/, 'must be a language code like de'),
    problem: (languages, t) => {
      if (t.language === null) return 'device language unknown';
      return languages.includes(t.language) ? null : `language ${t.language} is not ${languages.join(', ')}`;
    },
  }),
  notifications_enabled: trait({
    label: 'Notifications on',
    kind: 'boolean',
    group: 'device',
    needs: 'personalization_analytics',
    schema: z.boolean(),
    problem: (wanted, t) => {
      if (t.notificationsEnabled === null) return 'notification setting unknown';
      return wanted === t.notificationsEnabled ? null : wanted ? 'notifications are off' : 'notifications are on';
    },
  }),
  low_memory_device: trait({
    label: 'Low-memory device',
    kind: 'boolean',
    group: 'device',
    needs: 'personalization_analytics',
    schema: z.boolean(),
    problem: (wanted, t) => {
      if (t.lowMemoryDevice === null) return 'device memory unknown';
      return wanted === t.lowMemoryDevice ? null : wanted ? 'not a low-memory device' : 'a low-memory device';
    },
  }),
  local_hour: trait({
    label: 'Local hour',
    kind: 'range',
    group: 'device',
    needs: 'personalization_analytics',
    bounds: { min: 0, max: 23 },
    schema: rangeSchema({ min: 0, max: 23 }, true),
    problem: (range, t) => {
      if (t.localHour === null) return 'time zone unknown';
      return inRange(t.localHour, range, true) ? null : `local hour ${t.localHour} is not ${rangeText(range)}`;
    },
  }),
  install_sources: trait({
    label: 'Install source',
    kind: 'tags',
    group: 'device',
    needs: 'personalization_analytics',
    schema: z.array(z.string().min(1).max(100)).min(1).max(50),
    problem: (sources, t) => {
      if (t.installSource === null) return 'install source unknown';
      return sources.includes(t.installSource) ? null : `install source ${t.installSource} is not ${sources.join(', ')}`;
    },
  }),
};

// Conditions of parameter rules
export const RULE_FIELDS = {
  ...SHARED_FIELDS,
  ...TRAIT_FIELDS,
  user_ids: field({
    label: 'User IDs',
    kind: 'user_ids',
    schema: z.array(z.uuid()).min(1).max(1000),
    problem: (ids, ctx) => (ids.includes(ctx.userId) ? null : 'user is not in user_ids'),
  }),
};

// Targeting of experiments; new_users_only is checked by the experiment itself,
// since it depends on the start time
export const TARGETING_FIELDS = { ...SHARED_FIELDS, ...TRAIT_FIELDS };

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
  group: ConditionGroup;
  needs?: ConditionNeeds;
  options?: readonly string[];
  bounds?: { min: number; max: number };
}

// For the rule and targeting editors of the admin panel
export function describeConditionFields(): { rules: ConditionFieldInfo[]; targeting: ConditionFieldInfo[] } {
  const describe = (fields: Fields): ConditionFieldInfo[] =>
    Object.entries(fields).map(([key, f]) => ({
      key,
      label: f.label,
      kind: f.kind,
      group: f.group ?? 'user',
      ...(f.needs ? { needs: f.needs } : {}),
      ...(f.options ? { options: f.options } : {}),
      ...(f.bounds ? { bounds: f.bounds } : {}),
    }));
  return {
    rules: describe(RULE_FIELDS),
    targeting: [
      ...describe(TARGETING_FIELDS),
      { key: 'new_users_only', label: 'New users only', kind: 'boolean', group: 'user' },
    ],
  };
}
