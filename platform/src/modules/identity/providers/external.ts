import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { z } from 'zod';
import { config } from '../../../core/config.js';
import { AppError } from '../../../core/errors.js';
import { getIdentityKeys } from '../../apps/service.js';
import { hashNonce } from '../nonce.js';
import type { VerifiedIdentity } from './types.js';
import { subjectProblem } from './subject.js';

// Accounts of the app's own system (email and password, phone, any provider),
// confirmed by the app backend with a signed assertion.

// Long enough for the merge dialog, like the nonce
const MAX_ASSERTION_AGE = '10m';
const ALGORITHMS = ['EdDSA', 'ES256'];

const claimsSchema = z.object({
  sub: z.string().min(1).max(255),
  nonce: z.string().min(1),
  email: z.string().max(320).optional(),
  email_verified: z.boolean().optional(),
});

function reject(reason: string): never {
  throw new AppError(401, 'invalid_provider_token', 'Sign-in token is invalid', `external:${reason}`);
}

export async function verifyExternalAssertion(appId: string, assertion: string): Promise<VerifiedIdentity> {
  let kid: string | undefined;
  try {
    kid = decodeProtectedHeader(assertion).kid;
  } catch {
    reject('malformed');
  }
  if (!kid) reject('no_kid');

  // Only keys of the app the user belongs to: another app's backend cannot sign in here
  const stored = (await getIdentityKeys(appId)).find((key) => key.kid === kid);
  if (!stored) reject('unknown_kid');

  let payload: unknown;
  try {
    const key = await importJWK(stored.publicJwk, stored.publicJwk.alg);
    ({ payload } = await jwtVerify(assertion, key, {
      issuer: appId,
      audience: config.JWT_ISSUER,
      algorithms: ALGORITHMS,
      requiredClaims: ['iat', 'exp'],
      maxTokenAge: MAX_ASSERTION_AGE,
      clockTolerance: '30s',
    }));
  } catch (err) {
    reject((err as { code?: string }).code ?? 'verification_failed');
  }

  const claims = claimsSchema.safeParse(payload);
  if (!claims.success) reject('invalid_claims');

  // A placeholder from a bug in the backend would merge everyone into one account
  const problem = subjectProblem(claims.data.sub);
  if (problem) reject(`illegal_subject:${problem}`);

  return {
    provider: 'external',
    subject: claims.data.sub,
    email: claims.data.email ?? null,
    emailVerified: claims.data.email_verified ?? false,
    emailIsPrivateRelay: false,
    nonceHash: hashNonce(claims.data.nonce),
  };
}