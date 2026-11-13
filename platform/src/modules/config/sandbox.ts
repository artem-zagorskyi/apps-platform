import { desc, eq } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import type { Platform } from '../apps/schema.js';
import { z } from 'zod';
import { authIdentities, installations, users } from '../identity/schema.js';
import { loadTraitContext } from '../traits/builtin.js';
import {
  ENGAGEMENT_LEVELS,
  type EvaluationContext,
  type PersonalTraits,
  SIGN_IN_METHODS,
  SUBSCRIPTION_STATUSES,
} from './conditions.js';
import type { ConfigDocument } from './document.js';
import { explainConfig } from './evaluate.js';
import { configDrafts } from './schema.js';
import { getConfigVersion } from './versions-service.js';

// Admin sandbox: which config a user gets from the live version or the draft,
// and why. Reads only; nothing reaches the user.

const days = z.number().int().min(0).max(3650);

// Traits of a user described by hand
export const personalTraitsFormat: z.ZodType<PersonalTraits> = z.strictObject({
  daysSinceInstall: days,
  daysSinceLastVisit: days.nullable(),
  activeDays7: z.number().int().min(0).max(7),
  activeDays28: z.number().int().min(0).max(28),
  streakDays: days,
  engagement: z.enum(ENGAGEMENT_LEVELS),
  subscription: z.enum(SUBSCRIPTION_STATUSES),
  entitlements: z.array(z.string().min(1).max(64)).max(20),
  hasPurchased: z.boolean(),
  daysSinceSubscriptionEnded: days.nullable(),
  language: z.string().regex(/^[a-z]{2}$/).nullable(),
  notificationsEnabled: z.boolean().nullable(),
  lowMemoryDevice: z.boolean().nullable(),
  localHour: z.number().int().min(0).max(23).nullable(),
  installSource: z.string().min(1).max(100).nullable(),
});

export type SandboxUser =
  // A real user: everything else is read from their latest installation
  | { kind: 'id'; userId: string; installationId?: string }
  // A user described by hand: no ID, so no holdout and no experiments.
  // traits null: no personalization consent.
  | {
      kind: 'manual';
      platform: Platform;
      appVersion: string;
      country: string | null;
      linked: boolean;
      signIn?: (typeof SIGN_IN_METHODS)[number];
      osVersion?: string | null;
      traits?: PersonalTraits | null;
    };

// Merges chain at most this deep; a longer chain means broken data
const MAX_MERGE_HOPS = 5;

async function configToExplain(appId: string, config: 'live' | 'draft') {
  if (config === 'live') {
    const live = await getConfigVersion(appId);
    return {
      config: { kind: 'live' as const, version: live?.number ?? null },
      active: live && { number: live.number, document: live.document as ConfigDocument },
    };
  }
  const [draft] = await db.select().from(configDrafts).where(eq(configDrafts.appId, appId));
  if (!draft) throw new AppError(404, 'no_draft', 'There is no draft');
  return {
    config: { kind: 'draft' as const, baseVersion: draft.baseVersion },
    active: { number: draft.baseVersion ?? 0, document: draft.document as ConfigDocument },
  };
}

// The user as the phone sees them: merged users lead to the user they were merged into
async function findUser(appId: string, userId: string) {
  let id = userId;
  for (let hop = 0; hop <= MAX_MERGE_HOPS; hop++) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user || user.appId !== appId || user.status === 'deleted') break;
    if (user.status === 'merged' && user.mergedInto) {
      id = user.mergedInto;
      continue;
    }
    return { user, mergedFrom: id === userId ? null : userId };
  }
  throw new AppError(404, 'user_not_found', 'No such user in this app');
}

async function describeUser(appId: string, who: Extract<SandboxUser, { kind: 'id' }>) {
  const { user, mergedFrom } = await findUser(appId, who.userId);

  const [found, linked] = await Promise.all([
    db
      .select({
        id: installations.id,
        platform: installations.platform,
        appVersion: installations.appVersion,
        osVersion: installations.osVersion,
        deviceManufacturer: installations.deviceManufacturer,
        deviceModel: installations.deviceModel,
        country: installations.country,
        city: installations.city,
        lastSeenAt: installations.lastSeenAt,
      })
      .from(installations)
      .where(eq(installations.userId, user.id))
      .orderBy(desc(installations.lastSeenAt)),
    db.select({ provider: authIdentities.provider }).from(authIdentities).where(eq(authIdentities.userId, user.id)),
  ]);
  if (found.length === 0) throw new AppError(409, 'no_installation', 'The user has no installation');

  // The asked one, otherwise the one seen last
  const installation = found.find((item) => item.id === who.installationId) ?? found[0]!;
  const providers = linked.map((row) => row.provider).sort();

  const { osVersion, traits } = await loadTraitContext({
    appId,
    userId: user.id,
    installationId: installation.id,
    createdAt: user.createdAt,
  });
  const ctx: EvaluationContext = {
    appId,
    userId: user.id,
    platform: installation.platform,
    appVersion: installation.appVersion,
    // The phone is placed by the IP of each request; here the last known place
    country: installation.country,
    linked: providers.length > 0,
    userCreatedAt: user.createdAt,
    osVersion,
    providers,
    traits,
  };
  return {
    ctx,
    user: {
      id: user.id,
      mergedFrom,
      status: user.status,
      createdAt: user.createdAt,
      linked: providers,
      installationId: installation.id,
      installations: found,
    },
  };
}

export async function explainForSandbox(appId: string, config: 'live' | 'draft', who: SandboxUser, now: Date = new Date()) {
  const { config: source, active } = await configToExplain(appId, config);

  if (who.kind === 'id') {
    const { ctx, user } = await describeUser(appId, who);
    return {
      config: source,
      user,
      context: contextSummary(ctx),
      explanation: explainConfig(active, ctx),
    };
  }

  const providers = who.signIn && who.signIn !== 'anonymous' ? [who.signIn] : [];
  const ctx: EvaluationContext = {
    appId,
    userId: '',
    platform: who.platform,
    appVersion: who.appVersion,
    country: who.country,
    linked: who.linked || providers.length > 0,
    userCreatedAt: now,
    osVersion: who.osVersion ?? null,
    providers,
    traits: who.traits ?? null,
  };
  return {
    config: source,
    user: null,
    context: contextSummary(ctx),
    explanation: explainConfig(active, ctx, { bucketing: false }),
  };
}

// What the explanation was computed from, for the admin panel
function contextSummary(ctx: EvaluationContext) {
  return {
    platform: ctx.platform,
    appVersion: ctx.appVersion,
    country: ctx.country,
    linked: ctx.linked,
    osVersion: ctx.osVersion ?? null,
    providers: ctx.providers ?? [],
    // null: no personalization consent
    traits: ctx.traits ?? null,
  };
}
