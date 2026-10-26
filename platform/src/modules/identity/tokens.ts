import { createHash, randomBytes } from 'node:crypto';
import { createLocalJWKSet, importJWK, jwtVerify, SignJWT } from 'jose';
import { config } from '../../core/config.js';
import type { platformEnum } from '../apps/schema.js';

type Platform = (typeof platformEnum.enumValues)[number];

// What every access token says about its holder
export interface AccessTokenClaims {
  userId: string; // "sub"
  appId: string; // "aud": app backends accept only tokens for their app
  installationId: string; // "ins"
  platform: Platform; // "plt"
}

// The first key signs new tokens; all keys are published for verification
const [currentKey] = config.JWT_SIGNING_KEYS;
if (!currentKey) throw new Error('JWT_SIGNING_KEYS is empty');

const signingKey = await importJWK(currentKey, 'EdDSA');

// Public halves of all keys: everything except the private part "d"
export const publicJwks = config.JWT_SIGNING_KEYS.map(({ d: _private, ...publicPart }) => publicPart);

const verificationKeys = createLocalJWKSet({ keys: publicJwks });

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ ins: claims.installationId, plt: claims.platform })
    .setProtectedHeader({ alg: 'EdDSA', kid: currentKey.kid })
    .setSubject(claims.userId)
    .setAudience(claims.appId)
    .setIssuer(config.JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(signingKey);
}

// Throws if the signature, issuer, audience or expiry is invalid
export async function verifyAccessToken(
  token: string,
  appId?: string,
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, verificationKeys, {
    issuer: config.JWT_ISSUER,
    algorithms: ['EdDSA'],
    ...(appId && { audience: appId }),
  });

  return {
    userId: payload.sub as string,
    appId: payload.aud as string,
    installationId: payload.ins as string,
    platform: payload.plt as Platform,
  };
}

// Refresh token: 32 random bytes. Only its hash is stored in the database.
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

// SHA-256 is safe here: a random 32-byte token cannot be brute-forced,
// and a fast hash lets us find the session instantly
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}