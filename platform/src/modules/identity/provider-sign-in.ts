import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { AppError, isUniqueViolation } from '../../core/errors.js';
import { getOAuthClientIds } from '../apps/service.js';
import { consumeNonce } from './nonce.js';
import { verifyGoogleIdToken } from './providers/google.js';
import type { VerifiedIdentity } from './providers/types.js';
import {
  authIdentities,
  installations,
  type mergeStrategyEnum,
  sessions,
  userMerges,
  users,
} from './schema.js';
import {
  type IssuedRefresh,
  insertSession,
  issueTokenPair,
  type TokenPair,
} from './service.js';
import type { AccessTokenClaims } from './tokens.js';

export type MergeStrategy = (typeof mergeStrategyEnum.enumValues)[number];

export interface ProviderSignInResult {
  result: 'linked' | 'already_linked' | 'signed_in';
  userId: string;
  // New tokens only when the device switched to another user
  tokens: TokenPair | null;
}

type Outcome =
  | { kind: 'linked' | 'already_linked' }
  | { kind: 'merged'; targetUserId: string; refresh: IssuedRefresh };

const unauthorized = (reason: string) =>
  new AppError(401, 'unauthorized', 'Session is no longer valid', reason);

const accountExists = () =>
  new AppError(409, 'account_exists', 'This account already exists; retry with a merge strategy');

// Links a verified Google / Apple account to the current user, or signs
// the device into the user who already owns it (merging the current
// anonymous user into them). Provider-agnostic.
export async function signInWithProvider(
  auth: AccessTokenClaims,
  identity: VerifiedIdentity,
  strategy?: MergeStrategy,
): Promise<ProviderSignInResult> {
  const now = new Date();
  const providerFields = {
    email: identity.email,
    emailVerified: identity.emailVerified,
    emailIsPrivateRelay: identity.emailIsPrivateRelay,
    lastUsedAt: now,
  };

  let outcome: Outcome;

  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
      // Lock the device: merges and logouts reassign it
      const [installation] = await tx
        .select({ ownerId: installations.userId })
        .from(installations)
        .where(eq(installations.id, auth.installationId))
        .for('update');
      if (!installation || installation.ownerId !== auth.userId) {
        throw unauthorized('installation_reassigned');
      }

      const [current] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, auth.userId));
      if (current?.status !== 'active') {
        throw unauthorized(`user_${current?.status ?? 'missing'}`);
      }

      // Rolled back with the transaction on any refusal below,
      // so a retry with a merge strategy can reuse the same token
      if (!(await consumeNonce(tx, identity.nonceHash, auth.installationId))) {
        throw new AppError(401, 'invalid_provider_token', 'Sign-in token is invalid', `${identity.provider}:nonce_rejected`);
      }

      // Who owns this provider account in this app, if anyone
      const [existing] = await tx
        .select({ id: authIdentities.id, userId: authIdentities.userId })
        .from(authIdentities)
        .where(
          and(
            eq(authIdentities.appId, auth.appId),
            eq(authIdentities.provider, identity.provider),
            eq(authIdentities.providerSubject, identity.subject),
          ),
        );

      // Accounts already linked to the current user
      const currentLinks = await tx
        .select({ provider: authIdentities.provider })
        .from(authIdentities)
        .where(eq(authIdentities.userId, auth.userId));

      // Already linked to the current user: refresh the stored details
      if (existing?.userId === auth.userId) {
        await tx
          .update(authIdentities)
          .set(providerFields)
          .where(eq(authIdentities.id, existing.id));
        return { kind: 'already_linked' };
      }

      // A new account: link it, unless another one of this provider is linked
      if (!existing) {
        if (currentLinks.some((link) => link.provider === identity.provider)) {
          throw new AppError(409, 'provider_already_linked', `Another ${identity.provider} account is already linked`);
        }

        await tx.insert(authIdentities).values({
          appId: auth.appId,
          userId: auth.userId,
          provider: identity.provider,
          providerSubject: identity.subject,
          ...providerFields,
        });
        return { kind: 'linked' };
      }

      // The account belongs to another user. Only an anonymous user may be merged.
      if (currentLinks.length > 0) {
        throw new AppError(409, 'already_signed_in', 'Sign out before signing in with another account');
      }

      const [target] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, existing.userId));
      if (target?.status !== 'active') {
        throw new AppError(409, 'account_unavailable', 'This account is not available');
      }

      // First attempt: let the app ask the person which progress to keep
      if (!strategy) throw accountExists();

      // Merge: the anonymous current user is folded into the existing account
      await tx
        .update(sessions)
        .set({ revokedAt: now, revokeReason: 'merged' })
        .where(and(eq(sessions.userId, auth.userId), isNull(sessions.revokedAt)));

      await tx
        .update(users)
        .set({ status: 'merged', mergedInto: existing.userId })
        .where(eq(users.id, auth.userId));

      await tx
        .update(installations)
        .set({ userId: existing.userId, updatedAt: now })
        .where(eq(installations.id, auth.installationId));

      // The app backend is notified later from this record (notified_at stays null)
      await tx.insert(userMerges).values({
        appId: auth.appId,
        sourceUserId: auth.userId,
        targetUserId: existing.userId,
        installationId: auth.installationId,
        strategy,
      });

      await tx
        .update(authIdentities)
        .set(providerFields)
        .where(eq(authIdentities.id, existing.id));

      const refresh = await insertSession(tx, existing.userId, auth.installationId, now);
      return { kind: 'merged', targetUserId: existing.userId, refresh };
    });
  } catch (err) {
    // Another device linked the same new account a moment earlier
    if (isUniqueViolation(err, 'auth_identities_provider_account_key')) {
      throw accountExists();
    }
    // A parallel request linked another account of this provider
    if (isUniqueViolation(err, 'auth_identities_user_provider_key')) {
      throw new AppError(409, 'provider_already_linked', `Another ${identity.provider} account is already linked`);
    }
    throw err;
  }

  if (outcome.kind === 'merged') {
    return {
      result: 'signed_in',
      userId: outcome.targetUserId,
      tokens: await issueTokenPair({ ...auth, userId: outcome.targetUserId }, outcome.refresh),
    };
  }

  return { result: outcome.kind, userId: auth.userId, tokens: null };
}

export async function signInWithGoogle(
  auth: AccessTokenClaims,
  idToken: string,
  strategy?: MergeStrategy,
): Promise<ProviderSignInResult> {
  const clientIds = await getOAuthClientIds(auth.appId, 'google');
  const identity = await verifyGoogleIdToken(idToken, clientIds);
  return signInWithProvider(auth, identity, strategy);
}