import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { config } from '../../core/config.js';
import { db } from '../../core/db.js';
import { AppError, isUniqueViolation } from '../../core/errors.js';
import type { Platform } from '../apps/schema.js';
import { isAppPlatformActive } from '../apps/service.js';
import { installations, sessions, users } from './schema.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from './tokens.js';

export interface AnonymousSignUpInput {
  appId: string;
  installationId: string;
  platform: Platform;
  appVersion: string;
  appBuild: string;
  osVersion: string;
}

export interface TokenPair {
  userId: string;
  accessToken: string;
  accessTokenExpiresIn: number; // seconds
  refreshToken: string;
  refreshTokenExpiresAt: string; // ISO 8601
}

const DAY_MS = 24 * 60 * 60 * 1000;

function refreshExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + config.REFRESH_TOKEN_TTL_DAYS * DAY_MS);
}

// First launch: create a user, the installation and a session in one transaction
export async function signUpAnonymous(input: AnonymousSignUpInput): Promise<TokenPair> {
  if (!(await isAppPlatformActive(input.appId, input.platform))) {
    throw new AppError(400, 'unknown_app', 'App is unknown, disabled or not available on this platform');
  }

  const refresh = generateRefreshToken();
  const refreshTokenExpiresAt = refreshExpiryFrom(new Date());

  let userId: string;

  try {
    userId = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ appId: input.appId })
        .returning({ id: users.id });
      if (!user) throw new Error('User insert returned no row');

      await tx.insert(installations).values({
        id: input.installationId,
        appId: input.appId,
        userId: user.id,
        platform: input.platform,
        appVersion: input.appVersion,
        appBuild: input.appBuild,
        osVersion: input.osVersion,
      });

      await tx.insert(sessions).values({
        userId: user.id,
        installationId: input.installationId,
        familyId: randomUUID(), // a new sign-in starts a new token family
        tokenHash: refresh.hash,
        expiresAt: refreshTokenExpiresAt,
      });

      return user.id;
    });
  } catch (err) {
    // Installation ids are not secrets, so an existing one never gets tokens.
    // The client must generate a new installation id and retry.
    if (isUniqueViolation(err, 'installations_pkey')) {
      throw new AppError(409, 'installation_exists', 'Installation id is already registered');
    }
    throw err;
  }

  const accessToken = await signAccessToken({
    userId,
    appId: input.appId,
    installationId: input.installationId,
    platform: input.platform,
  });

  return {
    userId,
    accessToken,
    accessTokenExpiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
  };
}

type RefreshOutcome =
  | {
      ok: true;
      userId: string;
      appId: string;
      installationId: string;
      platform: Platform;
      refreshToken: string;
      refreshTokenExpiresAt: Date;
    }
  | { ok: false; reason: string };

const reject = (reason: string): RefreshOutcome => ({ ok: false, reason });

// Exchange a refresh token for a new token pair (rotation).
// Reuse of an already rotated token revokes the whole family,
// except for a quick retry after a lost response (grace window).
export async function refreshSession(refreshToken: string): Promise<TokenPair> {
  const tokenHash = hashRefreshToken(refreshToken);
  const now = new Date();
  const graceMs = config.REFRESH_REUSE_GRACE_SECONDS * 1000;

  const outcome = await db.transaction(async (tx): Promise<RefreshOutcome> => {
    // Lock the session row so two parallel refreshes cannot both rotate it
    const [row] = await tx
      .select({
        session: sessions,
        userStatus: users.status,
        appId: installations.appId,
        platform: installations.platform,
        installationOwnerId: installations.userId,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(installations, eq(installations.id, sessions.installationId))
      .where(eq(sessions.tokenHash, tokenHash))
      .for('update', { of: sessions });

    if (!row) return reject('unknown_token');

    const { session } = row;

    if (session.revokedAt) return reject(`revoked:${session.revokeReason}`);

    if (session.rotatedAt) {
      // Already exchanged once. Allowed only as a quick retry
      // while the token issued in exchange is still unused.
      const [successor] = session.replacedBy
        ? await tx
            .select({ rotatedAt: sessions.rotatedAt, revokedAt: sessions.revokedAt })
            .from(sessions)
            .where(eq(sessions.id, session.replacedBy))
            .for('update')
        : [];

      const withinGrace = now.getTime() - session.rotatedAt.getTime() <= graceMs;
      const successorUnused = successor && !successor.rotatedAt && !successor.revokedAt;

      if (!withinGrace || !successorUnused) {
        // Two parties hold this token: revoke every live token of the family
        await tx
          .update(sessions)
          .set({ revokedAt: now, revokeReason: 'reuse_detected' })
          .where(and(eq(sessions.familyId, session.familyId), isNull(sessions.revokedAt)));
        return reject('reuse_detected');
      }

      // Retry after a lost response: retire the unused successor, rotate again
      await tx
        .update(sessions)
        .set({ revokedAt: now, revokeReason: 'superseded' })
        .where(eq(sessions.id, session.replacedBy!));
    }

    if (session.expiresAt <= now) return reject('expired');
    if (row.userStatus !== 'active') return reject(`user_${row.userStatus}`);
    // After a merge or logout the device belongs to another user
    if (row.installationOwnerId !== session.userId) return reject('installation_reassigned');

    const next = generateRefreshToken();
    const refreshTokenExpiresAt = refreshExpiryFrom(now);

    const [created] = await tx
      .insert(sessions)
      .values({
        userId: session.userId,
        installationId: session.installationId,
        familyId: session.familyId,
        tokenHash: next.hash,
        expiresAt: refreshTokenExpiresAt,
      })
      .returning({ id: sessions.id });
    if (!created) throw new Error('Session insert returned no row');

    await tx
      .update(sessions)
      // Keep the first rotation time so retries cannot extend the grace window
      .set({ rotatedAt: session.rotatedAt ?? now, replacedBy: created.id })
      .where(eq(sessions.id, session.id));

    await tx
      .update(installations)
      .set({ lastSeenAt: now })
      .where(eq(installations.id, session.installationId));

    return {
      ok: true,
      userId: session.userId,
      appId: row.appId,
      installationId: session.installationId,
      platform: row.platform,
      refreshToken: next.token,
      refreshTokenExpiresAt,
    };
  });

  // Thrown after the transaction so a family revocation is committed, not rolled back
  if (!outcome.ok) {
    throw new AppError(401, 'invalid_refresh_token', 'Refresh token is invalid or expired', outcome.reason);
  }

  const accessToken = await signAccessToken({
    userId: outcome.userId,
    appId: outcome.appId,
    installationId: outcome.installationId,
    platform: outcome.platform,
  });

  return {
    userId: outcome.userId,
    accessToken,
    accessTokenExpiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: outcome.refreshToken,
    refreshTokenExpiresAt: outcome.refreshTokenExpiresAt.toISOString(),
  };
}