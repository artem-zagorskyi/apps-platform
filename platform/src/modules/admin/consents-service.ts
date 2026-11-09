import { and, eq, gt } from 'drizzle-orm';
import { db, type Tx } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { consentPolicies } from '../apps/schema.js';
import { installations } from '../identity/schema.js';
import type { AdminApp } from './apps-service.js';
import { type Actor, writeAudit } from './audit.js';

// Renvix is established in the EU, so the GDPR covers every user of an app
// wherever they live: an app has one policy, stored under the region "*"
const APP_REGION = '*';
// "Asked again" counts installations seen within this window
const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// "none" is not offered: it would mean analytics without consent
export type AdminConsentMode = 'optional' | 'consent_or_pay';

const policyColumns = {
  id: consentPolicies.id,
  mode: consentPolicies.mode,
  policyVersion: consentPolicies.policyVersion,
  repromptAfterDays: consentPolicies.repromptAfterDays,
  createdAt: consentPolicies.createdAt,
};

async function findPolicy(executor: typeof db | Tx, appId: string) {
  const [policy] = await executor
    .select(policyColumns)
    .from(consentPolicies)
    .where(and(eq(consentPolicies.appId, appId), eq(consentPolicies.region, APP_REGION)));
  return policy ?? null;
}

// Policy versions are dates. A second new version on the same day gets a
// suffix: 2026-11-09, 2026-11-09-2, 2026-11-09-3.
export function nextPolicyVersion(current: string | null, now: Date = new Date()): string {
  const today = now.toISOString().slice(0, 10);
  if (!current?.startsWith(today)) {
    return today;
  }
  const suffix = Number(current.slice(today.length + 1)) || 1;
  return `${today}-${suffix + 1}`;
}

export async function getConsentSettings(appId: string, now: Date = new Date()) {
  const since = new Date(now.getTime() - ACTIVE_WINDOW_MS);
  const [policy, activeInstallations] = await Promise.all([
    findPolicy(db, appId),
    db.$count(installations, and(eq(installations.appId, appId), gt(installations.lastSeenAt, since))),
  ]);
  return { policy, activeInstallations };
}

// Creates the app's policy, versioned from today, or changes its mode and
// reprompt interval. A change does not ask anyone again: that is a new version.
export async function saveConsentPolicy(
  actor: Actor,
  app: AdminApp,
  input: { mode: AdminConsentMode; repromptAfterDays: number },
  now: Date = new Date(),
) {
  return db.transaction(async (tx) => {
    const before = await findPolicy(tx, app.id);

    if (!before) {
      const values = {
        region: APP_REGION,
        mode: input.mode,
        policyVersion: nextPolicyVersion(null, now),
        repromptAfterDays: input.repromptAfterDays,
      };
      const [created] = await tx
        .insert(consentPolicies)
        .values({ appId: app.id, ...values })
        .returning(policyColumns);
      await writeAudit(
        {
          adminId: actor.adminId,
          action: 'consent_policy.create',
          appId: app.id,
          targetType: 'consent_policy',
          targetId: created!.id,
          after: values,
          ip: actor.ip,
        },
        tx,
      );
      return created!;
    }

    if (before.mode === input.mode && before.repromptAfterDays === input.repromptAfterDays) {
      return before;
    }

    const [updated] = await tx
      .update(consentPolicies)
      .set({ mode: input.mode, repromptAfterDays: input.repromptAfterDays })
      .where(eq(consentPolicies.id, before.id))
      .returning(policyColumns);
    await writeAudit(
      {
        adminId: actor.adminId,
        action: 'consent_policy.update',
        appId: app.id,
        targetType: 'consent_policy',
        targetId: before.id,
        before: { mode: before.mode, repromptAfterDays: before.repromptAfterDays },
        after: input,
        ip: actor.ip,
      },
      tx,
    );
    return updated!;
  });
}

// Everyone is asked again on next launch; earlier decisions stay in the log
export async function newConsentPolicyVersion(actor: Actor, app: AdminApp, reason: string, now: Date = new Date()) {
  return db.transaction(async (tx) => {
    const before = await findPolicy(tx, app.id);
    if (!before) {
      throw new AppError(404, 'no_policy', 'The app has no consent policy yet');
    }

    const policyVersion = nextPolicyVersion(before.policyVersion, now);
    const [updated] = await tx
      .update(consentPolicies)
      .set({ policyVersion })
      .where(eq(consentPolicies.id, before.id))
      .returning(policyColumns);
    await writeAudit(
      {
        adminId: actor.adminId,
        action: 'consent_policy.new_version',
        appId: app.id,
        targetType: 'consent_policy',
        targetId: before.id,
        reason,
        before: { policyVersion: before.policyVersion },
        after: { policyVersion },
        ip: actor.ip,
      },
      tx,
    );
    return updated!;
  });
}