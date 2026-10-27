import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedApp, signUpViaApi } from '../../../test/helpers.js';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import { consumeNonce, hashNonce } from './nonce.js';
import { authNonces } from './schema.js';

let server: FastifyInstance;
let appId: string;

beforeEach(async () => {
  await resetDatabase();
  appId = await seedApp();
  server = await buildApp();
});

afterEach(async () => {
  await server.close();
});

afterAll(async () => {
  await pool.end();
});

async function requestNonce(accessToken?: string) {
  return server.inject({
    method: 'POST',
    url: '/v1/auth/nonce',
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

function consume(nonce: string, installationId: string) {
  return db.transaction((tx) => consumeNonce(tx, hashNonce(nonce), installationId));
}

describe('POST /v1/auth/nonce', () => {
  it('issues a nonce and stores only its hash', async () => {
    const user = await signUpViaApi(server, appId);

    const res = await requestNonce(user.accessToken);

    expect(res.statusCode).toBe(200);
    const { nonce } = res.json();

    const rows = await db
      .select()
      .from(authNonces)
      .where(eq(authNonces.installationId, user.installationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.nonceHash).toBe(hashNonce(nonce));
    expect(rows[0]?.nonceHash).not.toBe(nonce);
  });

  it('requires an access token', async () => {
    const res = await requestNonce();

    expect(res.statusCode).toBe(401);
  });

  it('removes expired nonces of the installation when issuing a new one', async () => {
    const user = await signUpViaApi(server, appId);
    await requestNonce(user.accessToken);
    await db
      .update(authNonces)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authNonces.installationId, user.installationId));

    await requestNonce(user.accessToken);

    const rows = await db
      .select()
      .from(authNonces)
      .where(eq(authNonces.installationId, user.installationId));
    expect(rows).toHaveLength(1);
  });
});

describe('consumeNonce', () => {
  it('succeeds exactly once', async () => {
    const user = await signUpViaApi(server, appId);
    const { nonce } = (await requestNonce(user.accessToken)).json();

    expect(await consume(nonce, user.installationId)).toBe(true);
    expect(await consume(nonce, user.installationId)).toBe(false);
  });

  it('rejects a nonce issued to another installation', async () => {
    const owner = await signUpViaApi(server, appId);
    const other = await signUpViaApi(server, appId);
    const { nonce } = (await requestNonce(owner.accessToken)).json();

    expect(await consume(nonce, other.installationId)).toBe(false);
  });

  it('rejects an expired nonce', async () => {
    const user = await signUpViaApi(server, appId);
    const { nonce } = (await requestNonce(user.accessToken)).json();
    await db
      .update(authNonces)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authNonces.nonceHash, hashNonce(nonce)));

    expect(await consume(nonce, user.installationId)).toBe(false);
  });

  it('stays usable when the surrounding transaction rolls back', async () => {
    const user = await signUpViaApi(server, appId);
    const { nonce } = (await requestNonce(user.accessToken)).json();

    // Simulates a sign-in that ends with 409 account_exists
    await expect(
      db.transaction(async (tx) => {
        await consumeNonce(tx, hashNonce(nonce), user.installationId);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await consume(nonce, user.installationId)).toBe(true);
  });
});