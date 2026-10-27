import { createHash, randomBytes } from 'node:crypto';
import { createLocalJWKSet, importJWK, jwtVerify, SignJWT } from 'jose';
import { config } from '../../core/config.js';
import { z } from 'zod';
import { platformEnum, type Platform } from '../apps/schema.js';

// What every access token says about its holder
export interface AccessTokenClaims {
  userId: string; // "sub"
  appId: string; // "aud": app backends accept only tokens for their app
  installationId: string; // "ins"
  platform: Platform; // "plt"
}

// Expected shape of the access token payload
const accessClaimsSchema = z.object({
  sub: z.uuid(),
  aud: z.uuid(),
  ins: z.uuid(),
  plt: z.enum(platformEnum.enumValues),
});

// The first key signs new tokens; all keys are published for verification
const [currentKey] = config.JWT_SIGNING_KEYS;
if (!currentKey) throw new Error('JWT_SIGNING_KEYS is empty');

// Resolved here, where TypeScript knows the key exists
const currentKid = currentKey.kid;
const signingKey = await importJWK(currentKey, 'EdDSA');

// Public halves of all keys: everything except the private part "d"
export const publicJwks = config.JWT_SIGNING_KEYS.map(({ d: _private, ...publicPart }) => publicPart);

const verificationKeys = createLocalJWKSet({ keys: publicJwks });

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ ins: claims.installationId, plt: claims.platform })
    .setProtectedHeader({ alg: 'EdDSA', kid: currentKid })
    .setSubject(claims.userId)
    .setAudience(claims.appId)
    .setIssuer(config.JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(signingKey);
}

// Throws if the signature, issuer, audience, expiry or claims are invalid
export async function verifyAccessToken(
  token: string,
  appId?: string,
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, verificationKeys, {
    issuer: config.JWT_ISSUER,
    algorithms: ['EdDSA'],
    ...(appId && { audience: appId }),
  });

  const claims = accessClaimsSchema.parse(payload);

  return {
    userId: claims.sub,
    appId: claims.aud,
    installationId: claims.ins,
    platform: claims.plt,
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