// Result of verifying a Google or Apple ID token.
// Sign-in logic works with this and does not care which provider it came from.
export interface VerifiedIdentity {
  provider: 'google' | 'apple';
  // Stable account id at the provider ("sub" claim)
  subject: string;
  email: string | null;
  emailVerified: boolean;
  emailIsPrivateRelay: boolean;
  // SHA-256 hex of the nonce, ready to look up in auth_nonces
  nonceHash: string;
}