import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { AppError } from '../../../core/errors.js';
import { hashNonce } from '../nonce.js';
import type { VerifiedIdentity } from './types.js';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

// Google's public keys, fetched on first use and cached by jose.
// Replaced with a local test key in tests.
let googleKeys: JWTVerifyGetKey = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

// Test-only: make the verifier trust a locally generated key
export function setGoogleKeysForTests(keys: JWTVerifyGetKey): void {
  googleKeys = keys;
}

const googleClaimsSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().optional(),
  // Usually a boolean, but older tokens may carry the string "true"
  email_verified: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
    .optional(),
  // Required: the client must request a nonce from us before signing in
  nonce: z.string().min(1),
});

function rejectToken(reason: string): never {
  throw new AppError(401, 'invalid_provider_token', 'Google token is invalid', `google:${reason}`);
}

// Verifies a Google ID token issued for one of the given client IDs
export async function verifyGoogleIdToken(
  idToken: string,
  allowedClientIds: string[],
): Promise<VerifiedIdentity> {
  // An empty audience list would let jose skip the audience check
  if (allowedClientIds.length === 0) rejectToken('no_client_ids_configured');

  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(idToken, googleKeys, {
      issuer: GOOGLE_ISSUERS,
      audience: allowedClientIds,
      algorithms: ['RS256'],
      // Tolerate small clock differences between Google and our server
      clockTolerance: '30s',
    }));
  } catch (err) {
    rejectToken((err as { code?: string }).code ?? 'verification_failed');
  }

  const claims = googleClaimsSchema.safeParse(payload);
  if (!claims.success) rejectToken('invalid_claims');

  return {
    provider: 'google',
    subject: claims.data.sub,
    email: claims.data.email ?? null,
    emailVerified: claims.data.email_verified ?? false,
    emailIsPrivateRelay: false,
    nonceHash: hashNonce(claims.data.nonce),
  };
}