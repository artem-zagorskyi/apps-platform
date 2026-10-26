import { randomUUID } from 'node:crypto';
import { config } from '../../core/config.js';
import { db } from '../../core/db.js';
import { AppError, isUniqueViolation } from '../../core/errors.js';
import type { Platform } from '../apps/schema.js';
import { isAppPlatformActive } from '../apps/service.js';
import { installations, sessions, users } from './schema.js';
import { generateRefreshToken, signAccessToken } from './tokens.js';

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

// First launch: create a user, the installation and a session in one transaction
export async function signUpAnonymous(input: AnonymousSignUpInput): Promise<TokenPair> {
  if (!(await isAppPlatformActive(input.appId, input.platform))) {
    throw new AppError(400, 'unknown_app', 'App is unknown, disabled or not available on this platform');
  }

  const refresh = generateRefreshToken();
  const refreshTokenExpiresAt = new Date(
    Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

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