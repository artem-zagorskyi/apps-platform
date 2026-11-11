import { desc, eq } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import type { Platform } from '../apps/schema.js';
import { authIdentities, installations, users } from '../identity/schema.js';
import type { EvaluationContext } from './conditions.js';
import type { ConfigDocument } from './document.js';
import { explainConfig } from './evaluate.js';
import { configDrafts } from './schema.js';
import { getConfigVersion } from './versions-service.js';

// Admin sandbox: which config a user gets from the live version or the draft,
// and why. Reads only; nothing reaches the user.

export type SandboxUser =
  // A real user: everything else is read from their latest installation
  | { kind: 'id'; userId: string; installationId?: string }
  // A user described by hand: no ID, so no holdout and no experiments
  | { kind: 'manual'; platform: Platform; appVersion: string; country: string | null; linked: boolean };

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

  const ctx: EvaluationContext = {
    appId,
    userId: user.id,
    platform: installation.platform,
    appVersion: installation.appVersion,
    country: installation.country,
    linked: providers.length > 0,
    userCreatedAt: user.createdAt,
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
      context: { platform: ctx.platform, appVersion: ctx.appVersion, country: ctx.country, linked: ctx.linked },
      explanation: explainConfig(active, ctx),
    };
  }

  const ctx: EvaluationContext = {
    appId,
    userId: '',
    platform: who.platform,
    appVersion: who.appVersion,
    country: who.country,
    linked: who.linked,
    userCreatedAt: now,
  };
  return {
    config: source,
    user: null,
    context: { platform: ctx.platform, appVersion: ctx.appVersion, country: ctx.country, linked: ctx.linked },
    explanation: explainConfig(active, ctx, { bucketing: false }),
  };
}
