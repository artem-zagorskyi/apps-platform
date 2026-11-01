import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, errors, importJWK, type JWK, type JWTVerifyGetKey, jwtVerify, SignJWT } from 'jose';

// ---------- Access tokens ----------

export interface PlatformUser {
  userId: string;
  installationId: string;
  platform: 'android' | 'ios';
}

// The token was refused; answer 401 so the SDK renews the session and retries
export class PlatformTokenError extends Error {
  constructor(
    message: string,
    // jose error code (e.g. ERR_JWT_EXPIRED) or malformed_claims
    readonly reason: string,
  ) {
    super(message);
    this.name = 'PlatformTokenError';
  }
}

export interface TokenVerifierOptions {
  // Platform server URL, e.g. https://platform.example.com
  platformUrl: string;
  // This app's id on the platform: tokens of other apps are refused
  appId: string;
  // JWT_ISSUER of the platform
  issuer?: string;
  // Keys instead of fetching the JWKS (tests)
  keys?: JWTVerifyGetKey;
}

// Verifies platform access tokens for one app. Keys come from the platform's
// JWKS and are cached; an unknown key id triggers a refetch (key rotation).
export function createTokenVerifier(options: TokenVerifierOptions): (token: string) => Promise<PlatformUser> {
  const base = options.platformUrl.endsWith('/') ? options.platformUrl : `${options.platformUrl}/`;
  const keys = options.keys ?? createRemoteJWKSet(new URL('.well-known/jwks.json', base));
  const issuer = options.issuer ?? 'apps-platform';

  return async (token) => {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer,
        audience: options.appId,
        algorithms: ['EdDSA'],
      }));
    } catch (err) {
      const reason = err instanceof errors.JOSEError ? err.code : 'invalid_token';
      throw new PlatformTokenError('Invalid platform access token', reason);
    }

    const { sub, ins, plt } = payload;
    if (typeof sub !== 'string' || typeof ins !== 'string' || (plt !== 'android' && plt !== 'ios')) {
      throw new PlatformTokenError('Malformed platform access token', 'malformed_claims');
    }
    return { userId: sub, installationId: ins, platform: plt };
  };
}

// The token from an "Authorization: Bearer <token>" header, or null
export function bearerToken(header: string | undefined): string | null {
  return /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1] ?? null;
}

// ---------- Webhooks ----------

export type MergeStrategy = 'keep_target' | 'keep_source' | 'merge';

interface WebhookBase {
  // Delivery id: the same notification may arrive twice, skip handled ids
  id: string;
  appId: string;
  createdAt: string;
}

export type PlatformWebhook =
  | (WebhookBase & {
      type: 'user.merged';
      data: {
        mergeId: string;
        sourceUserId: string;
        targetUserId: string;
        strategy: MergeStrategy;
        mergedAt: string;
      };
    })
  | (WebhookBase & {
      type: 'entitlements.changed';
      data: {
        userId: string;
        entitlements: {
          key: string;
          productId: string;
          store: 'google_play' | 'app_store';
          state: string;
          expiresAt: string | null;
          willRenew: boolean;
        }[];
      };
    })
  | (WebhookBase & {
      type: 'user.deleted';
      data: { userId: string; mergedUserIds: string[]; deletedAt: string };
    });

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

// Verifies the x-platform-signature header and returns the notification.
// rawBody must be the request body exactly as received, before JSON parsing.
export function verifyWebhook(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
  options: { toleranceSeconds?: number; now?: Date } = {},
): PlatformWebhook {
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signatureHeader ?? '');
  const timestamp = match?.[1];
  const received = match?.[2];
  if (!timestamp || !received) throw new WebhookSignatureError('Missing or malformed signature');

  // A captured notification cannot be replayed later
  const now = (options.now ?? new Date()).getTime() / 1000;
  if (Math.abs(now - Number(timestamp)) > (options.toleranceSeconds ?? 300)) {
    throw new WebhookSignatureError('Signature is too old');
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(received, 'hex'))) {
    throw new WebhookSignatureError('Signature does not match');
  }

  return JSON.parse(body) as PlatformWebhook;
}

// ---------- Identity assertions ----------

export interface IdentityAssertionOptions {
  // Private key printed by `pnpm identity:key` (base64url JSON) or a JWK
  privateKey: string | JWK;
  // This app's id on the platform
  appId: string;
  // Stable account id in the app's own system
  subject: string;
  // Nonce the SDK got from the platform; the app sends it with the login request
  nonce: string;
  email?: string;
  emailVerified?: boolean;
  // JWT_ISSUER of the platform
  platformAudience?: string;
}

// Confirms to the platform that a person signed in to the app's own account
// `subject`. The SDK sends the result to POST /v1/auth/external.
export async function createIdentityAssertion(options: IdentityAssertionOptions): Promise<string> {
  const jwk: JWK =
    typeof options.privateKey === 'string'
      ? (JSON.parse(Buffer.from(options.privateKey, 'base64url').toString('utf8')) as JWK)
      : options.privateKey;
  const alg = jwk.alg ?? 'EdDSA';
  if (!jwk.kid) throw new Error('The private key has no kid');

  return new SignJWT({
    nonce: options.nonce,
    ...(options.email !== undefined && { email: options.email }),
    ...(options.emailVerified !== undefined && { email_verified: options.emailVerified }),
  })
    .setProtectedHeader({ alg, kid: jwk.kid })
    .setIssuer(options.appId)
    .setAudience(options.platformAudience ?? 'apps-platform')
    .setSubject(options.subject)
    .setIssuedAt()
    // As long as the platform's nonce: enough for the merge dialog
    .setExpirationTime('10m')
    .sign(await importJWK(jwk, alg));
}