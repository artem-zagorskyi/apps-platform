import { randomUUID } from 'node:crypto';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  SignJWT,
} from 'jose';
import { setGoogleKeysForTests } from '../src/modules/identity/providers/google.js';

export const FAKE_GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';

// The key our fake Google signs with, and an attacker's key with the same kid
const google = await generateKeyPair('RS256');
const attacker = await generateKeyPair('RS256');

const publicJwk = { ...(await exportJWK(google.publicKey)), kid: 'fake-google', alg: 'RS256' };

// Makes the server trust the fake Google instead of the real one
export function installFakeGoogle(): void {
  setGoogleKeysForTests(createLocalJWKSet({ keys: [publicJwk] }));
}

interface FakeTokenOptions {
  subject?: string;
  nonce?: string | null; // null = no nonce claim at all
  audience?: string;
  issuer?: string;
  expiresAt?: number; // seconds since epoch
  claims?: JWTPayload; // extra or overriding claims
  signedByAttacker?: boolean;
}

// Signs an ID token the way Google would
export async function signFakeGoogleToken(options: FakeTokenOptions = {}): Promise<string> {
  const payload: JWTPayload = {
    email: 'player@gmail.com',
    email_verified: true,
    ...(options.nonce !== null && { nonce: options.nonce ?? randomUUID() }),
    ...options.claims,
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'fake-google' })
    .setIssuer(options.issuer ?? 'https://accounts.google.com')
    .setAudience(options.audience ?? FAKE_GOOGLE_CLIENT_ID)
    .setSubject(options.subject ?? randomUUID())
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? '1h')
    .sign(options.signedByAttacker ? attacker.privateKey : google.privateKey);
}