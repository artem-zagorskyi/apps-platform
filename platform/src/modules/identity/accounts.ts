import { and, eq } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { authIdentities, users } from './schema.js';

export interface AccountInfo {
  // After following merges: the user who owns the account now
  userId: string;
  status: (typeof users.$inferSelect)['status'];
  // Has any linked account (Google, Apple, the app's own)
  linked: boolean;
  // Of a linked account, if the provider gave one
  email: string | null;
}

// Who a user id stands for today, for decisions of other modules
// (e.g. who owns a purchase). Null for an unknown id.
export async function resolveAccount(appId: string, userId: string): Promise<AccountInfo | null> {
  let id = userId;
  // Merge chains are short; the limit only guards against bad data
  for (let step = 0; step < 10; step++) {
    const [user] = await db
      .select({ id: users.id, status: users.status, mergedInto: users.mergedInto })
      .from(users)
      .where(and(eq(users.id, id), eq(users.appId, appId)));
    if (!user) return null;

    if (user.status === 'merged' && user.mergedInto) {
      id = user.mergedInto;
      continue;
    }

    const links = await db
      .select({ email: authIdentities.email })
      .from(authIdentities)
      .where(eq(authIdentities.userId, user.id));
    return {
      userId: user.id,
      status: user.status,
      linked: links.length > 0,
      email: links.find((link) => link.email)?.email ?? null,
    };
  }
  return null;
}