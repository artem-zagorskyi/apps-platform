import { sql } from 'drizzle-orm';
import { bigint, check, index, inet, integer, jsonb, pgSchema, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, primaryId, tz } from '../../core/columns.js';
import { apps } from '../apps/schema.js';

// All tables of this module live in the "admin" Postgres schema
export const adminSchema = pgSchema('admin');

export const adminRoleEnum = adminSchema.enum('role', [
  'owner', // everything, including admins and creating apps
  'product', // config, experiments, plans, catalog, all analytics
  'support', // user card and its actions
  'viewer', // aggregate charts only, no personal data
]);

export const sessionRevokeReasonEnum = adminSchema.enum('session_revoke_reason', [
  'logout', // signed out of this session
  'logout_all', // "sign out everywhere else" from another session
  'disabled', // the admin was disabled
  'password_changed',
]);

export type AdminRole = (typeof adminRoleEnum.enumValues)[number];

// People who can sign in to the admin panel. Never deleted, only disabled:
// the audit log keeps pointing at them.
export const admins = adminSchema.table(
  'admins',
  {
    id: primaryId(),
    // Stored lowercased, so the unique constraint is case-insensitive
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(), // Argon2id
    // Encrypted with DATA_ENCRYPTION_KEY (core/crypto)
    totpSecret: text('totp_secret').notNull(),
    // Last accepted TOTP time step; a code is never accepted twice
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: tz('locked_until'),
    lastLoginAt: tz('last_login_at'),
    disabledAt: tz('disabled_at'),
    createdAt: createdAt(),
  },
  () => [check('admins_email_lowercase', sql`email = lower(email)`)],
);

// Role of an admin, for one app or (app_id null) for every app
export const roleGrants = adminSchema.table(
  'role_grants',
  {
    id: primaryId(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id),
    role: adminRoleEnum('role').notNull(),
    appId: uuid('app_id').references(() => apps.id),
    createdAt: createdAt(),
  },
  // One role per admin and app; "all apps" (null) counts as one value too
  (t) => [unique('role_grants_admin_app_key').on(t.adminId, t.appId).nullsNotDistinct()],
);

// One-time codes for signing in without the phone. Reissuing replaces the set.
export const recoveryCodes = adminSchema.table(
  'recovery_codes',
  {
    id: primaryId(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id),
    codeHash: text('code_hash').notNull(), // SHA-256 of the normalized code
    usedAt: tz('used_at'),
    createdAt: createdAt(),
  },
  (t) => [unique('recovery_codes_admin_hash_key').on(t.adminId, t.codeHash)],
);

// Admin panel sessions. The token itself lives only in the browser cookie;
// here only its SHA-256.
export const sessions = adminSchema.table(
  'sessions',
  {
    id: primaryId(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id),
    tokenHash: text('token_hash').notNull().unique(),
    // Updated at most once a minute; older than 30 minutes = idle, signed out
    lastUsedAt: tz('last_used_at').notNull().defaultNow(),
    expiresAt: tz('expires_at').notNull(), // hard limit: 12 hours after sign-in
    revokedAt: tz('revoked_at'),
    revokeReason: sessionRevokeReasonEnum('revoke_reason'),
    // Of the browser, passed on by the Next.js server
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_admin_idx').on(t.adminId)],
);

// Who did what, when and why. Append-only: a trigger (migration
// admin_audit_append_only) rejects UPDATE, DELETE and TRUNCATE.
// The primary key is UUIDv7, so it already orders rows by time.
export const auditLog = adminSchema.table(
  'audit_log',
  {
    id: primaryId(),
    adminId: uuid('admin_id').references(() => admins.id), // null: a script on the server
    action: text('action').notNull(), // e.g. auth.login, app.update, user.view
    // No foreign key on purpose: the log is history and must not be blocked
    // or emptied by anything that happens to apps later (e.g. TRUNCATE ... CASCADE)
    appId: uuid('app_id'),
    targetType: text('target_type'), // e.g. user, app, webhook
    targetId: text('target_id'),
    reason: text('reason'),
    before: jsonb('before'),
    after: jsonb('after'),
    details: jsonb('details'), // context that is not a change, e.g. the email of a failed login
    ip: inet('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_admin_idx').on(t.adminId, t.createdAt),
    index('audit_log_app_idx').on(t.appId, t.createdAt),
  ],
);