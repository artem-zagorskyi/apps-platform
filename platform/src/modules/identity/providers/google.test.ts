import { beforeAll, describe, expect, it } from 'vitest';
import {
  FAKE_GOOGLE_CLIENT_ID,
  installFakeGoogle,
  signFakeGoogleToken,
} from '../../../../test/fake-google.js';
import { hashNonce } from '../nonce.js';
import { verifyGoogleIdToken } from './google.js';

beforeAll(() => {
  installFakeGoogle();
});

const allowed = [FAKE_GOOGLE_CLIENT_ID];
const rejected = { statusCode: 401, code: 'invalid_provider_token' };

describe('verifyGoogleIdToken', () => {
  it('accepts a valid token and returns the account', async () => {
    const token = await signFakeGoogleToken({ subject: '1234567890', nonce: 'n-1' });

    const identity = await verifyGoogleIdToken(token, allowed);

    expect(identity).toEqual({
      provider: 'google',
      subject: '1234567890',
      email: 'player@gmail.com',
      emailVerified: true,
      emailIsPrivateRelay: false,
      nonceHash: hashNonce('n-1'),
    });
  });

  it('accepts email_verified sent as a string', async () => {
    const token = await signFakeGoogleToken({ claims: { email_verified: 'true' } });

    const identity = await verifyGoogleIdToken(token, allowed);

    expect(identity.emailVerified).toBe(true);
  });

  it('rejects a token issued for another app', async () => {
    const token = await signFakeGoogleToken({ audience: 'someone-else.apps.googleusercontent.com' });

    await expect(verifyGoogleIdToken(token, allowed)).rejects.toMatchObject(rejected);
  });

  it('rejects a token from another issuer', async () => {
    const token = await signFakeGoogleToken({ issuer: 'https://evil.example.com' });

    await expect(verifyGoogleIdToken(token, allowed)).rejects.toMatchObject(rejected);
  });

  it('rejects an expired token', async () => {
    const token = await signFakeGoogleToken({
      expiresAt: Math.floor(Date.now() / 1000) - 120,
    });

    await expect(verifyGoogleIdToken(token, allowed)).rejects.toMatchObject(rejected);
  });

  it('rejects a token signed with a different key', async () => {
    const token = await signFakeGoogleToken({ signedByAttacker: true });

    await expect(verifyGoogleIdToken(token, allowed)).rejects.toMatchObject(rejected);
  });

  it('rejects a token without a nonce', async () => {
    const token = await signFakeGoogleToken({ nonce: null });

    await expect(verifyGoogleIdToken(token, allowed)).rejects.toMatchObject(rejected);
  });

  it('rejects everything when the app has no client IDs configured', async () => {
    const token = await signFakeGoogleToken();

    await expect(verifyGoogleIdToken(token, [])).rejects.toMatchObject(rejected);
  });
});