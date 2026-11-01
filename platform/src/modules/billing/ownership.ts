import type { AccountInfo } from '../identity/accounts.js';

// Who gets a purchase sent from this device. The purchase belongs to the
// store account on the device; our owner was set when we first saw it.
export type Ownership =
  // The current user owns it already
  | { kind: 'keep' }
  // Nobody can claim it otherwise (unknown, anonymous or deleted owner): the current user gets it
  | { kind: 'assign' }
  // The owner has a linked account: sign in to it to get the purchase
  | { kind: 'sign_in_required'; ownerId: string; maskedEmail: string | null }
  // Another linked account is signed in on this device
  | { kind: 'other_account'; ownerId: string };

export function decideOwnership(currentUserId: string, currentLinked: boolean, owner: AccountInfo | null): Ownership {
  if (!owner) return { kind: 'assign' };
  if (owner.userId === currentUserId) return { kind: 'keep' };
  // An anonymous owner can never come back; a deleted one is gone
  if (owner.status !== 'active' || !owner.linked) return { kind: 'assign' };
  return currentLinked
    ? { kind: 'other_account', ownerId: owner.userId }
    : { kind: 'sign_in_required', ownerId: owner.userId, maskedEmail: maskEmail(owner.email) };
}

// a***@gmail.com: enough to recognize the account, not to reveal it
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  return `${email[0]}***${email.slice(at)}`;
}