
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { AppError, isUniqueViolation } from '../../core/errors.js';
import { generateIdentityKey } from '../apps/identity-keys.js';
import { appPlatforms, apps, identityKeys, oauthClients, type Platform } from '../apps/schema.js';

import { writeAudit, type Actor } from './audit.js';
import { ALL_ROLES, hasAppRole } from './roles.js';
import type { AdminRole } from './schema.js';
import type { AdminSession } from './service.js';

// Lowercase letters, digits and dashes; starts with a letter, 3 to 40 long
const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
// Stands for every app in admin panel URLs
const RESERVED_SLUG = 'all';

const BUNDLE_ID_PATTERNS: Record<Platform, RegExp> = {
  // Java package rules: two or more parts, each starting with a letter
  android: /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/,
  // Apple: letters, digits and dashes, two or more parts
  ios: /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/,
};

const appColumns = {
  id: apps.id,
  slug: apps.slug,
  name: apps.name,
  status: apps.status,
  createdAt: apps.createdAt,
};

export type AdminApp = Awaited<ReturnType<typeof findAppForAdmin>>;

// Apps the admin has any role on. A role without an app covers every app,
// including ones created later.
export async function listVisibleApps(session: AdminSession) {
  const coversAll = session.roles.some((grant) => grant.appId === null);
  const appIds = session.roles.flatMap((grant) => (grant.appId ? [grant.appId] : []));

  if (!coversAll && appIds.length === 0) {
    return [];
  }

  return db
    .select(appColumns)
    .from(apps)
    .where(coversAll ? undefined : inArray(apps.id, appIds))
    .orderBy(asc(apps.name));
}

// The app by slug, if the admin holds one of the roles on it.
// No role at all looks like no app (404), so other apps are not revealed;
// a role that does not allow this action is a 403.
export async function findAppForAdmin(session: AdminSession, slug: string, roles: readonly AdminRole[]) {
  const [app] = await db.select(appColumns).from(apps).where(eq(apps.slug, slug));

  if (app && hasAppRole(session, app.id, roles)) {
    return app;
  }
  if (app && hasAppRole(session, app.id, ALL_ROLES)) {
    throw new AppError(403, 'forbidden', 'Your role does not allow this action');
  }
  throw new AppError(404, 'app_not_found', `No app "${slug}"`);
}

export function getAppPlatforms(appId: string) {
  return db
    .select({
      platform: appPlatforms.platform,
      bundleId: appPlatforms.bundleId,
      createdAt: appPlatforms.createdAt,
    })
    .from(appPlatforms)
    .where(eq(appPlatforms.appId, appId))
    .orderBy(asc(appPlatforms.platform));
}

export async function createApp(actor: Actor, input: { slug: string; name: string }) {
  if (input.slug === RESERVED_SLUG || !SLUG_PATTERN.test(input.slug)) {
    throw new AppError(
      400,
      'invalid_slug',
      'Slug must be 3 to 40 lowercase letters, digits or dashes, start with a letter and not be "all"',
    );
  }

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(apps).values(input).returning(appColumns);
      await writeAudit(
        {
          adminId: actor.adminId,
          action: 'app.create',
          appId: created!.id,
          targetType: 'app',
          targetId: created!.id,
          after: input,
          ip: actor.ip,
        },
        tx,
      );
      return created!;
    });
  } catch (err) {
    if (isUniqueViolation(err, 'apps_slug_unique')) {
      throw new AppError(409, 'slug_taken', `Slug "${input.slug}" is already taken`);
    }
    throw err;
  }
}

export async function updateApp(
  actor: Actor,
  app: AdminApp,
  changes: { name?: string; status?: 'active' | 'disabled'; reason?: string },
) {
  const before = { name: app.name, status: app.status };
  const after = { name: changes.name ?? app.name, status: changes.status ?? app.status };

  if (before.name === after.name && before.status === after.status) {
    return app;
  }
  if (before.status === 'active' && after.status === 'disabled' && !changes.reason) {
    throw new AppError(400, 'reason_required', 'A reason is required to disable an app');
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx.update(apps).set(after).where(eq(apps.id, app.id)).returning(appColumns);
    await writeAudit(
      {
        adminId: actor.adminId,
        action: 'app.update',
        appId: app.id,
        targetType: 'app',
        targetId: app.id,
        reason: changes.reason,
        before,
        after,
        ip: actor.ip,
      },
      tx,
    );
    return updated!;
  });
}

// Adds a platform to the app or changes its package name / bundle ID
export async function setPlatform(actor: Actor, app: AdminApp, platform: Platform, bundleId: string) {
  if (!BUNDLE_ID_PATTERNS[platform].test(bundleId)) {
    throw new AppError(
      400,
      'invalid_bundle_id',
      platform === 'android' ? 'Not a valid Android package name' : 'Not a valid iOS bundle ID',
    );
  }

  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ bundleId: appPlatforms.bundleId })
        .from(appPlatforms)
        .where(and(eq(appPlatforms.appId, app.id), eq(appPlatforms.platform, platform)));

      if (existing?.bundleId === bundleId) {
        return { platform, bundleId };
      }

      await tx
        .insert(appPlatforms)
        .values({ appId: app.id, platform, bundleId })
        .onConflictDoUpdate({ target: [appPlatforms.appId, appPlatforms.platform], set: { bundleId } });

      await writeAudit(
        {
          adminId: actor.adminId,
          action: existing ? 'app.platform.update' : 'app.platform.add',
          appId: app.id,
          targetType: 'platform',
          targetId: platform,
          before: existing ? { bundleId: existing.bundleId } : undefined,
          after: { bundleId },
          ip: actor.ip,
        },
        tx,
      );
      return { platform, bundleId };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'app_platforms_platform_bundle_key')) {
      throw new AppError(409, 'bundle_id_taken', `${bundleId} already belongs to another app`);
    }
    throw err;
  }
}

// ---------- Sign-in ----------

// Google issues OAuth client IDs in this shape
const GOOGLE_CLIENT_ID = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
// Apple: the bundle ID or a Services ID, both dotted identifiers
const APPLE_CLIENT_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export async function getSignInSettings(appId: string) {
  const [clients, keys] = await Promise.all([
    db
      .select({
        id: oauthClients.id,
        provider: oauthClients.provider,
        platform: oauthClients.platform,
        clientId: oauthClients.clientId,
        createdAt: oauthClients.createdAt,
      })
      .from(oauthClients)
      .where(eq(oauthClients.appId, appId))
      .orderBy(asc(oauthClients.provider), asc(oauthClients.createdAt)),
    // Public halves stay out: the panel needs only the key ids and their state
    db
      .select({ kid: identityKeys.kid, createdAt: identityKeys.createdAt, revokedAt: identityKeys.revokedAt })
      .from(identityKeys)
      .where(eq(identityKeys.appId, appId))
      .orderBy(desc(identityKeys.createdAt)),
  ]);

  return { oauthClients: clients, identityKeys: keys };
}

export async function addOAuthClient(
  actor: Actor,
  app: AdminApp,
  input: { provider: 'google' | 'apple'; platform: Platform; clientId: string },
) {
  if (input.provider === 'apple' && input.platform !== 'ios') {
    throw new AppError(400, 'apple_ios_only', 'Sign in with Apple is offered on iOS only');
  }
  if (!(input.provider === 'google' ? GOOGLE_CLIENT_ID : APPLE_CLIENT_ID).test(input.clientId)) {
    throw new AppError(
      400,
      'invalid_client_id',
      input.provider === 'google'
        ? 'A Google client ID looks like 1234-abc.apps.googleusercontent.com'
        : 'An Apple client ID is a bundle ID or Services ID such as com.example.app',
    );
  }

  return db.transaction(async (tx) => {
    const [platform] = await tx
      .select({ platform: appPlatforms.platform })
      .from(appPlatforms)
      .where(and(eq(appPlatforms.appId, app.id), eq(appPlatforms.platform, input.platform)));
    if (!platform) {
      throw new AppError(400, 'platform_not_registered', `Add the ${input.platform} platform to the app first`);
    }

    // Unique per app and provider: one ID usually serves both platforms
    const [existing] = await tx
      .select({ id: oauthClients.id })
      .from(oauthClients)
      .where(
        and(
          eq(oauthClients.appId, app.id),
          eq(oauthClients.provider, input.provider),
          eq(oauthClients.clientId, input.clientId),
        ),
      );
    if (existing) {
      throw new AppError(409, 'client_exists', 'This client ID is already registered for the app');
    }

    const [created] = await tx
      .insert(oauthClients)
      .values({ appId: app.id, ...input })
      .returning({
        id: oauthClients.id,
        provider: oauthClients.provider,
        platform: oauthClients.platform,
        clientId: oauthClients.clientId,
        createdAt: oauthClients.createdAt,
      });

    await writeAudit(
      {
        adminId: actor.adminId,
        action: 'app.oauth_client.add',
        appId: app.id,
        targetType: 'oauth_client',
        targetId: created!.id,
        after: input,
        ip: actor.ip,
      },
      tx,
    );
    return created!;
  });
}

export async function removeOAuthClient(actor: Actor, app: AdminApp, id: string) {
  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(oauthClients)
      .where(and(eq(oauthClients.id, id), eq(oauthClients.appId, app.id)))
      .returning({ provider: oauthClients.provider, platform: oauthClients.platform, clientId: oauthClients.clientId });
    if (!removed) {
      throw new AppError(404, 'client_not_found', 'No such client for this app');
    }

    await writeAudit(
      {
        adminId: actor.adminId,
        action: 'app.oauth_client.remove',
        appId: app.id,
        targetType: 'oauth_client',
        targetId: id,
        before: removed,
        ip: actor.ip,
      },
      tx,
    );
  });
}

// The private key is returned once and never stored or logged
export async function createBackendKey(actor: Actor, app: AdminApp) {
  const key = await generateIdentityKey();

  await db.transaction(async (tx) => {
    await tx.insert(identityKeys).values({ appId: app.id, kid: key.kid, publicJwk: key.publicJwk });
    await writeAudit(
      {
        adminId: actor.adminId,
        action: 'app.identity_key.create',
        appId: app.id,
        targetType: 'identity_key',
        targetId: key.kid,
        ip: actor.ip,
      },
      tx,
    );
  });

  return { kid: key.kid, privateKey: key.privateKeyEnv };
}

export async function revokeBackendKey(actor: Actor, app: AdminApp, kid: string, reason: string) {
  await db.transaction(async (tx) => {
    const [revoked] = await tx
      .update(identityKeys)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(identityKeys.appId, app.id), eq(identityKeys.kid, kid), isNull(identityKeys.revokedAt)))
      .returning({ kid: identityKeys.kid });
    if (!revoked) {
      throw new AppError(404, 'key_not_found', 'No active key with this id');
    }

    await writeAudit(
      {
        adminId: actor.adminId,
        action: 'app.identity_key.revoke',
        appId: app.id,
        targetType: 'identity_key',
        targetId: kid,
        reason,
        ip: actor.ip,
      },
      tx,
    );
  });
}