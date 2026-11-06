import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAdminApp } from '../../admin-app.js';
import { buildApp } from '../../app.js';
import { decryptSecret } from '../../core/crypto.js';
import { db, pool } from '../../core/db.js';
import { admins, auditLog, sessions } from './schema.js';
import { createOwner } from './service.js';
import { hotp } from './totp.js';

const PASSWORD = 'correct horse battery';
const MINUTE = 60_000;
const CLIENT_IP = '198.51.100.7';

let server: FastifyInstance;

beforeEach(async () => {
  // Only Date is faked: TOTP codes and session times become predictable,
  // while timers, the database driver and Fastify keep working normally
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
  server = await buildAdminApp();
});

afterEach(async () => {
  await server.close();
  vi.useRealTimers();
});

afterAll(async () => {
  await pool.end();
});

interface TestAdmin {
  id: string;
  email: string;
  secret: Buffer;
  recoveryCodes: string[];
}

// Every test gets its own admin, so tests never see each other's data
async function createTestAdmin(): Promise<TestAdmin> {
  const email = `admin-${randomUUID()}@example.test`;
  const result = await createOwner(email, PASSWORD);
  if (!result.ok) throw new Error(`createOwner failed: ${result.reason}`);

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
function totp(admin: TestAdmin, stepOffset = 0): string {
  return hotp(admin.secret, Math.floor(Date.now() / 30_000) + stepOffset);
}

function login(body: { email: string; password: string; code: string }, ip = CLIENT_IP) {
  return server.inject({
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

function authed(method: 'GET' | 'POST', url: string, token: string) {
  return server.inject({ method, url: `/admin/v1${url}`, headers: { authorization: `Bearer ${token}` } });
}

function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

async function auditActions(adminId: string): Promise<string[]> {
  const rows = await db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.adminId, adminId))
    .orderBy(asc(auditLog.id));
  return rows.map((row) => row.action);
}

describe('admin sign-in', () => {
  it('signs in with password and TOTP code and returns the session', async () => {
    const admin = await createTestAdmin();

    const res = await login({ email: admin.email, password: PASSWORD, code: totp(admin) });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(new Date(body.expiresAt).getTime()).toBe(Date.now() + 12 * 60 * MINUTE);
    expect(body.remainingRecoveryCodes).toBeNull();

    const session = await authed('GET', '/auth/session', body.token);
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({
      adminId: admin.id,
      email: admin.email,
      roles: [{ role: 'owner', appId: null }],
    });
  });

  it('accepts the email in any case', async () => {
    const admin = await createTestAdmin();

    const res = await login({ email: admin.email.toUpperCase(), password: PASSWORD, code: totp(admin) });

    expect(res.statusCode).toBe(200);
  });

  it('answers a wrong password, a wrong code and an unknown email the same way', async () => {
    const admin = await createTestAdmin();

    const responses = await Promise.all([
      login({ email: admin.email, password: 'wrong password!', code: totp(admin) }),
      login({ email: admin.email, password: PASSWORD, code: totp(admin, 5) }),
      login({ email: `nobody-${randomUUID()}@example.test`, password: PASSWORD, code: '123456' }),
    ]);

    for (const res of responses) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(responses[0]!.json());
      expect(res.json().error).toBe('invalid_credentials');
    }
  });

  it('does not accept the same TOTP code twice', async () => {
    const admin = await createTestAdmin();
    const code = totp(admin);

    expect((await login({ email: admin.email, password: PASSWORD, code })).statusCode).toBe(200);
    expect((await login({ email: admin.email, password: PASSWORD, code })).statusCode).toBe(401);
  });

  it('accepts each recovery code once and reports how many are left', async () => {
    const admin = await createTestAdmin();
    // Typed by hand: lowercase, spaces instead of dashes
    const code = admin.recoveryCodes[0]!.toLowerCase().replaceAll('-', ' ');

    const first = await login({ email: admin.email, password: PASSWORD, code });
    expect(first.statusCode).toBe(200);
    expect(first.json().remainingRecoveryCodes).toBe(9);

    const again = await login({ email: admin.email, password: PASSWORD, code });
    expect(again.statusCode).toBe(401);
  });

  it('does not use up a recovery code on a wrong password', async () => {
    const admin = await createTestAdmin();
    const code = admin.recoveryCodes[0]!;

    expect((await login({ email: admin.email, password: 'wrong password!', code })).statusCode).toBe(401);
    expect((await login({ email: admin.email, password: PASSWORD, code })).statusCode).toBe(200);
  });

  it('locks the account for 15 minutes after five failures', async () => {
    const admin = await createTestAdmin();
    const wrong = { email: admin.email, password: 'wrong password!', code: totp(admin) };

    for (let attempt = 1; attempt <= 4; attempt++) {
      expect((await login(wrong)).statusCode).toBe(401);
    }
    const fifth = await login(wrong);
    expect(fifth.statusCode).toBe(423);
    expect(fifth.json().error).toBe('account_locked');

    // Even the right password and code do not get in while locked
    const locked = await login({ email: admin.email, password: PASSWORD, code: totp(admin) });
    expect(locked.statusCode).toBe(423);

    advance(15 * MINUTE + 1000);
    await signIn(admin);

    expect(await auditActions(admin.id)).toEqual([
      'auth.login_failed',
      'auth.login_failed',
      'auth.login_failed',
      'auth.login_failed',
      'auth.locked',
      'auth.login_blocked',
      'auth.login',
    ]);
  });

  it('limits sign-in attempts per browser IP', async () => {
    const ip = '198.51.100.99';
    const attempt = () =>
      login({ email: `nobody-${randomUUID()}@example.test`, password: PASSWORD, code: '123456' }, ip);

    for (let i = 0; i < 10; i++) {
      expect((await attempt()).statusCode).toBe(401);
    }
    expect((await attempt()).statusCode).toBe(429);

    // Another browser is not affected
    expect((await login({ email: 'nobody@example.test', password: PASSWORD, code: '123456' })).statusCode).toBe(401);
  });

  it('shuts out a disabled admin, including live sessions', async () => {
    const admin = await createTestAdmin();
    const token = await signIn(admin);

    await db.update(admins).set({ disabledAt: new Date() }).where(eq(admins.id, admin.id));

    expect((await authed('GET', '/auth/session', token)).statusCode).toBe(401);
    expect((await login({ email: admin.email, password: PASSWORD, code: totp(admin, 1) })).statusCode).toBe(401);
  });
});

describe('admin sessions', () => {
  it('ends after 30 minutes without activity; activity keeps it alive', async () => {
    const admin = await createTestAdmin();
    const token = await signIn(admin);

    advance(29 * MINUTE);
    expect((await authed('GET', '/auth/session', token)).statusCode).toBe(200);

    // 58 minutes after sign-in, but only 29 after the last request
    advance(29 * MINUTE);
    expect((await authed('GET', '/auth/session', token)).statusCode).toBe(200);

    advance(31 * MINUTE);
    const expired = await authed('GET', '/auth/session', token);
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error).toBe('session_expired');
  });

  it('ends 12 hours after sign-in even with activity', async () => {
    const admin = await createTestAdmin();
    const token = await signIn(admin);

    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.adminId, admin.id));

    expect((await authed('GET', '/auth/session', token)).statusCode).toBe(401);
  });

  it('rejects a missing or unknown token', async () => {
    const missing = await server.inject({ method: 'GET', url: '/admin/v1/auth/session' });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error).toBe('unauthorized');

    const unknown = await authed('GET', '/auth/session', randomUUID());
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error).toBe('session_expired');
  });

  it('logout ends only the current session', async () => {
    const admin = await createTestAdmin();
    const first = await signIn(admin, 0);
    const second = await signIn(admin, 1);

    expect((await authed('POST', '/auth/logout', first)).statusCode).toBe(204);

    expect((await authed('GET', '/auth/session', first)).statusCode).toBe(401);
    expect((await authed('GET', '/auth/session', second)).statusCode).toBe(200);
  });

  it('signs out every other session and lists the remaining one', async () => {
    const admin = await createTestAdmin();
    const current = await signIn(admin, 0);
    const other = await signIn(admin, 1);

    const res = await authed('POST', '/auth/sessions/revoke-others', current);
    expect(res.json()).toEqual({ revoked: 1 });

    expect((await authed('GET', '/auth/session', other)).statusCode).toBe(401);

    const list = await authed('GET', '/auth/sessions', current);
    expect(list.json().sessions).toEqual([
      expect.objectContaining({ current: true, ip: CLIENT_IP, userAgent: 'vitest' }),
    ]);
  });

  it('does not exist on the public server', async () => {
    const publicApp = await buildApp();

    const res = await publicApp.inject({
      method: 'POST',
      url: '/admin/v1/auth/login',
      payload: { email: 'a@example.test', password: PASSWORD, code: '123456' },
    });
    await publicApp.close();

    expect(res.statusCode).toBe(404);
  });
});

describe('admin audit log', () => {
  it('cannot be changed or deleted', async () => {
    const admin = await createTestAdmin();
    await signIn(admin);

    // Drizzle wraps the driver error; the trigger's message is in the cause
    const errorOf = (query: Promise<unknown>) =>
      query.then(
        () => null,
        (err: { message?: string; cause?: { message?: string } }) => err.cause?.message ?? err.message,
      );

    const updateError = await errorOf(
      db.update(auditLog).set({ reason: 'edited' }).where(eq(auditLog.adminId, admin.id)),
    );
    const deleteError = await errorOf(db.delete(auditLog).where(eq(auditLog.adminId, admin.id)));

    expect(updateError).toContain('append-only');
    expect(deleteError).toContain('append-only');
    expect(await auditActions(admin.id)).toEqual(['auth.login']);
  });
});