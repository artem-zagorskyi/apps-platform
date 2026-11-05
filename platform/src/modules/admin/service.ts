import { and, desc, eq, gt, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '../../core/crypto.js';
import { db } from '../../core/db.js';
import { writeAudit } from './audit.js';
import {
  MIN_PASSWORD_LENGTH,
  generateRecoveryCodes,
  generateSessionToken,
  hashPassword,
  hashRecoveryCode,
  sha256,
  verifyPassword,
} from './credentials.js';
import { admins, recoveryCodes, roleGrants, sessions, type AdminRole } from './schema.js';
import { generateTotpSecret, totpUri, verifyTotp } from './totp.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
// last_used_at is written at most this often, not on every request
const TOUCH_INTERVAL_MS = 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

type Admin = typeof admins.$inferSelect;

// Browser details passed on by the Next.js server
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export interface AdminSession {
  sessionId: string;
  adminId: string;
  email: string;
  roles: { role: AdminRole; appId: string | null }[];
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------- Sign-in ----------

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; remainingRecoveryCodes: number | null }
  | { ok: false; reason: 'invalid_credentials' }
  | { ok: false; reason: 'locked'; lockedUntil: Date };

// Email, password and code are checked in one request. The answer never says
// which of them was wrong; the audit log does.
export async function login(
  input: { email: string; password: string; code: string },
  client: ClientInfo,
): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const [found] = await db.select().from(admins).where(eq(admins.email, email));
  const admin = found && !found.disabledAt ? found : undefined;

  if (admin?.lockedUntil && admin.lockedUntil > new Date()) {
    await writeAudit({ adminId: admin.id, action: 'auth.login_blocked', ip: client.ip });
    return { ok: false, reason: 'locked', lockedUntil: admin.lockedUntil };
  }

  // Runs for unknown and disabled admins too, against a dummy hash
  const passwordOk = await verifyPassword(admin?.passwordHash ?? null, input.password);

  if (!admin) {
    await writeAudit({
      adminId: null,
      action: 'auth.login_failed',
      details: { email, reason: found ? 'disabled' : 'unknown_email' },
      ip: client.ip,
    });
    return { ok: false, reason: 'invalid_credentials' };
  }

  // The second factor is checked only after the right password,
  // so a wrong password never uses up a recovery code
  const method = passwordOk ? await consumeSecondFactor(admin, input.code) : null;

  if (!method) {
    return registerFailure(admin.id, passwordOk ? 'second_factor' : 'password', client);
  }

  const { token, tokenHash } = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.transaction(async (tx) => {
    await tx
      .update(admins)
      .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: sql`now()` })
      .where(eq(admins.id, admin.id));
    await tx.insert(sessions).values({
      adminId: admin.id,
      tokenHash,
      expiresAt,
      ip: client.ip,
      userAgent: client.userAgent,
    });
    await writeAudit({ adminId: admin.id, action: 'auth.login', details: { method }, ip: client.ip }, tx);
  });

  // After a recovery code the panel warns when few are left
  const remainingRecoveryCodes =
    method === 'recovery_code'
      ? await db.$count(recoveryCodes, and(eq(recoveryCodes.adminId, admin.id), isNull(recoveryCodes.usedAt)))
      : null;

  return { ok: true, token, expiresAt, remainingRecoveryCodes };
}

// Six digits are a TOTP code, anything else a recovery code.
// Both are used up by a conditional UPDATE, so two parallel requests
// with the same code cannot both succeed.
async function consumeSecondFactor(admin: Admin, input: string): Promise<'totp' | 'recovery_code' | null> {
  const code = input.replace(/\s/g, '');

  if (/^\d{6}$/.test(code)) {
    const secret = Buffer.from(decryptSecret(admin.totpSecret), 'base64url');
    const step = verifyTotp(secret, code, admin.totpLastStep);
    if (step === null) return null;

    const updated = await db
      .update(admins)
      .set({ totpLastStep: step })
      .where(and(eq(admins.id, admin.id), or(isNull(admins.totpLastStep), lt(admins.totpLastStep, step))))
      .returning({ id: admins.id });
    return updated.length > 0 ? 'totp' : null;
  }

  const used = await db
    .update(recoveryCodes)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(recoveryCodes.adminId, admin.id),
        eq(recoveryCodes.codeHash, hashRecoveryCode(code)),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  return used.length > 0 ? 'recovery_code' : null;
}

async function registerFailure(
  adminId: string,
  factor: 'password' | 'second_factor',
  client: ClientInfo,
): Promise<LoginResult> {
  const lockUntil = new Date(Date.now() + LOCKOUT_MS).toISOString();

  // One statement, so parallel attempts cannot slip past the limit.
  // On the fifth failure the lock starts and the counter restarts at zero.
  const [row] = await db
    .update(admins)
    .set({
      failedLogins: sql`case when ${admins.failedLogins} + 1 >= ${MAX_FAILED_LOGINS}
        then 0 else ${admins.failedLogins} + 1 end`,
      lockedUntil: sql`case when ${admins.failedLogins} + 1 >= ${MAX_FAILED_LOGINS}
        then ${lockUntil}::timestamptz else ${admins.lockedUntil} end`,
    })
    .where(eq(admins.id, adminId))
    .returning({ lockedUntil: admins.lockedUntil });

  const lockedUntil = row?.lockedUntil && row.lockedUntil > new Date() ? row.lockedUntil : null;

  await writeAudit({
    adminId,
    action: lockedUntil ? 'auth.locked' : 'auth.login_failed',
    details: { factor },
    ip: client.ip,
  });

  return lockedUntil ? { ok: false, reason: 'locked', lockedUntil } : { ok: false, reason: 'invalid_credentials' };
}

// ---------- Sessions ----------

// Called for every admin API request. Null means: no session, revoked,
// expired, idle for 30 minutes, or the admin was disabled.
export async function authenticate(token: string): Promise<AdminSession | null> {
  const now = Date.now();

  const [row] = await db
    .select({
      sessionId: sessions.id,
      adminId: admins.id,
      email: admins.email,
      lastUsedAt: sessions.lastUsedAt,
    })
    .from(sessions)
    .innerJoin(admins, eq(admins.id, sessions.adminId))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date(now)),
        gt(sessions.lastUsedAt, new Date(now - IDLE_TIMEOUT_MS)),
        isNull(admins.disabledAt),
      ),
    );

  if (!row) return null;

  if (now - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastUsedAt: new Date(now) }).where(eq(sessions.id, row.sessionId));
  }

  const roles = await db
    .select({ role: roleGrants.role, appId: roleGrants.appId })
    .from(roleGrants)
    .where(eq(roleGrants.adminId, row.adminId));

  return { sessionId: row.sessionId, adminId: row.adminId, email: row.email, roles };
}

export async function logout(session: AdminSession, client: ClientInfo): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: 'logout' })
      .where(and(eq(sessions.id, session.sessionId), isNull(sessions.revokedAt)));
    await writeAudit({ adminId: session.adminId, action: 'auth.logout', ip: client.ip }, tx);
  });
}

// "Sign out everywhere else" on the My account page; the current session stays
export async function revokeOtherSessions(session: AdminSession, client: ClientInfo): Promise<number> {
  return db.transaction(async (tx) => {
    const revoked = await tx
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: 'logout_all' })
      .where(
        and(
          eq(sessions.adminId, session.adminId),
          ne(sessions.id, session.sessionId),
          isNull(sessions.revokedAt),
        ),
      )
      .returning({ id: sessions.id });
    await writeAudit(
      { adminId: session.adminId, action: 'auth.logout_all', details: { count: revoked.length }, ip: client.ip },
      tx,
    );
    return revoked.length;
  });
}

// Live sessions of the signed-in admin, newest activity first
export async function listSessions(session: AdminSession) {
  const now = Date.now();
  const rows = await db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
      expiresAt: sessions.expiresAt,
      ip: sessions.ip,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.adminId, session.adminId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date(now)),
        gt(sessions.lastUsedAt, new Date(now - IDLE_TIMEOUT_MS)),
      ),
    )
    .orderBy(desc(sessions.lastUsedAt));

  return rows.map((row) => ({ ...row, current: row.id === session.sessionId }));
}

// ---------- Creating admins ----------

export type CreateAdminResult =
  | { ok: true; adminId: string; totpUri: string; recoveryCodes: string[] }
  | { ok: false; reason: 'email_taken' | 'password_too_short' };

// Used by the admin:create script on the server; there is no sign-up over
// the web. Creates an owner of every app: other roles come with a second person.
export async function createOwner(emailInput: string, password: string): Promise<CreateAdminResult> {
  const email = normalizeEmail(emailInput);

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: 'password_too_short' };
  }
  const [existing] = await db.select({ id: admins.id }).from(admins).where(eq(admins.email, email));
  if (existing) {
    return { ok: false, reason: 'email_taken' };
  }

  const secret = generateTotpSecret();
  const codes = generateRecoveryCodes();
  const passwordHash = await hashPassword(password);

  const adminId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(admins)
      .values({ email, passwordHash, totpSecret: encryptSecret(secret.toString('base64url')) })
      .returning({ id: admins.id });
    const id = created!.id;

    await tx.insert(roleGrants).values({ adminId: id, role: 'owner', appId: null });
    await tx.insert(recoveryCodes).values(codes.map((code) => ({ adminId: id, codeHash: hashRecoveryCode(code) })));
    await writeAudit(
      {
        adminId: null,
        action: 'admin.create',
        targetType: 'admin',
        targetId: id,
        after: { email, role: 'owner', appId: null },
        details: { via: 'script' },
      },
      tx,
    );
    return id;
  });

  return { ok: true, adminId, totpUri: totpUri(secret, email), recoveryCodes: codes };
}