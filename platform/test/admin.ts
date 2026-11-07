import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { decryptSecret } from '../src/core/crypto.js';
import { db } from '../src/core/db.js';
import { admins, roleGrants, type AdminRole } from '../src/modules/admin/schema.js';
import { createOwner } from '../src/modules/admin/service.js';
import { hotp } from '../src/modules/admin/totp.js';

export const PASSWORD = 'correct horse battery';
export const CLIENT_IP = '198.51.100.7';

export interface TestAdmin {
  id: string;
  email: string;
  secret: Buffer;
  recoveryCodes: string[];
}

// A fresh admin per test, so tests never see each other's data.
// An owner of every app unless `grant` gives another role or one app.
export async function createTestAdmin(grant?: { role: AdminRole; appId: string | null }): Promise<TestAdmin> {
  const email = `admin-${randomUUID()}@example.test`;
  const result = await createOwner(email, PASSWORD);
  if (!result.ok) throw new Error(`createOwner failed: ${result.reason}`);

  if (grant) {
    await db.update(roleGrants).set(grant).where(eq(roleGrants.adminId, result.adminId));
  }

  const [row] = await db
    .select({ totpSecret: admins.totpSecret })
    .from(admins)
    .where(eq(admins.id, result.adminId));

  return {
    id: result.adminId,
    email,
    secret: Buffer.from(decryptSecret(row!.totpSecret), 'base64url'),
    recoveryCodes: result.recoveryCodes,
  };
}

// The code the authenticator app shows now, shifted by whole 30-second steps
export function totp(admin: TestAdmin, stepOffset = 0): string {
  return hotp(admin.secret, Math.floor(Date.now() / 30_000) + stepOffset);
}

// Request helpers bound to the current test server (rebuilt for every test)
export function adminRequests(getServer: () => FastifyInstance) {
  function login(body: { email: string; password: string; code: string }, ip = CLIENT_IP) {
    return getServer().inject({
      method: 'POST',
      url: '/admin/v1/auth/login',
      payload: body,
      headers: { 'x-client-ip': ip, 'x-client-user-agent': 'vitest' },
    });
  }

  async function signIn(admin: TestAdmin, stepOffset = 0): Promise<string> {
    const res = await login({ email: admin.email, password: PASSWORD, code: totp(admin, stepOffset) });
    expect(res.statusCode).toBe(200);
    return res.json().token;
  }

  function authed(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    token: string,
    payload?: unknown,
  ) {
    return getServer().inject({
      method,
      url: `/admin/v1${url}`,
      headers: { authorization: `Bearer ${token}`, 'x-client-ip': CLIENT_IP },
      ...(payload !== undefined && { payload: payload as object }),
    });
  }

  return { login, signIn, authed };
}