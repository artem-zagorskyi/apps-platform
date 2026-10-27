import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { db, type Tx } from '../../core/db.js';
import { authNonces } from './schema.js';

// Long enough to finish the sign-in sheet and a merge dialog
const NONCE_TTL_MS = 10 * 60 * 1000;

// SHA-256 in hex: the format Apple uses for nonces in its tokens
export function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

// Issues a nonce for a sign-in on this installation
export async function issueNonce(
  installationId: string,
): Promise<{ nonce: string; expiresAt: string }> {
  const nonce = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);

  await db.transaction(async (tx) => {
    // Housekeeping: drop this installation's expired nonces
    await tx
      .delete(authNonces)
      .where(and(eq(authNonces.installationId, installationId), lt(authNonces.expiresAt, now)));

    await tx.insert(authNonces).values({
      installationId,
      nonceHash: hashNonce(nonce),
      expiresAt,
    });
  });

  return { nonce, expiresAt: expiresAt.toISOString() };
}

// Marks a nonce as used. Succeeds only once, only for the installation
// it was issued to, and only before it expires. A single UPDATE makes
// this safe against parallel attempts with the same nonce.
// Runs inside the caller's transaction: if the sign-in is rolled back
// (e.g. 409 account_exists), the nonce stays usable for the retry.
export async function consumeNonce(
  tx: Tx,
  nonceHash: string,
  installationId: string,
): Promise<boolean> {
  const now = new Date();

  const used = await tx
    .update(authNonces)
    .set({ usedAt: now })
    .where(
      and(
        eq(authNonces.nonceHash, nonceHash),
        eq(authNonces.installationId, installationId),
        isNull(authNonces.usedAt),
        gt(authNonces.expiresAt, now),
      ),
    )
    .returning({ id: authNonces.id });

  return used.length > 0;
}