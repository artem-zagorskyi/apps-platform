import { existsSync } from 'node:fs';
import { exportJWK, generateKeyPair } from 'jose';

// Prepares environment variables for tests. Safe to call more than once.
// Uses the database server from platform/.env (or DATABASE_URL in CI)
// with a separate "<name>_test" database, so development data is never touched.
export async function prepareTestEnv(): Promise<{ devUrl: string; testUrl: string }> {
  if (!process.env.DATABASE_URL && existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  const current = process.env.DATABASE_URL;
  if (!current) throw new Error('DATABASE_URL is not set: create platform/.env');

  const testUrl = new URL(current);
  if (!testUrl.pathname.endsWith('_test')) testUrl.pathname += '_test';

  const devUrl = new URL(testUrl);
  devUrl.pathname = testUrl.pathname.replace(/_test$/, '');

  process.env.DATABASE_URL = testUrl.toString();
  process.env.NODE_ENV = 'test';
    // Silent by default; set TEST_LOG_LEVEL=error to see server errors while debugging
  process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';

  // A throwaway signing key, so tests need no secrets
  if (!process.env.JWT_SIGNING_KEYS) {
    const { privateKey } = await generateKeyPair('EdDSA', { extractable: true });
    const jwk = { ...(await exportJWK(privateKey)), kid: 'test-key', alg: 'EdDSA', use: 'sig' };
    process.env.JWT_SIGNING_KEYS = Buffer.from(JSON.stringify([jwk])).toString('base64url');
  }

  return { devUrl: devUrl.toString(), testUrl: testUrl.toString() };
}