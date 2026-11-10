import type { FastifyRequest } from 'fastify';
import { AppError } from '../../core/errors.js';
import { type AccessTokenClaims, verifyAccessToken } from './tokens.js';
import { assertAppNotDisabled } from '../apps/service.js';
import { markActive } from './activity.js';

declare module 'fastify' {
  interface FastifyRequest {
    // Set by requireAuth on protected routes, null everywhere else
    auth: AccessTokenClaims | null;
  }
}

const BEARER = /^Bearer\s+(\S+)$/i;

// preHandler for protected routes: verifies the access token
// from the Authorization header and stores its claims in request.auth
export async function requireAuth(request: FastifyRequest): Promise<void> {
  const token = request.headers.authorization?.match(BEARER)?.[1];

  if (!token) {
    throw new AppError(401, 'unauthorized', 'Missing or malformed access token', 'no_bearer_token');
  }

  let claims: AccessTokenClaims;
  try {
    claims = await verifyAccessToken(token);
  } catch (err) {
    // jose errors carry a code such as ERR_JWT_EXPIRED; schema errors do not
    const reason = (err as { code?: string }).code ?? 'invalid_claims';
    throw new AppError(401, 'unauthorized', 'Access token is invalid or expired', reason);
  }

  // A disabled app is stopped for everyone, even with a valid token
  await assertAppNotDisabled(claims.appId);
  request.auth = claims;

  // Usage statistics; a failed write never fails the request
  try {
    await markActive(claims);
  } catch (err) {
    request.log.warn({ err }, 'activity mark failed');
  }
}

// Claims of the current request. Only valid on routes with requireAuth.
export function authOf(request: FastifyRequest): AccessTokenClaims {
  if (!request.auth) {
    throw new Error('authOf() called on a route without requireAuth');
  }
  return request.auth;
}