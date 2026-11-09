import { and, eq, gt } from 'drizzle-orm';
import { db, type Tx } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { consentPolicies } from '../apps/schema.js';
import { entitlementsOnSale } from '../billing/catalog.js';
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

export interface ConsentPolicyInput {
  mode: AdminConsentMode;
  repromptAfterDays: number;
  // Required for consent_or_pay; ignored for optional, which keeps the stored one
  payEntitlement?: string | null;
}

const policyColumns = {
  id: consentPolicies.id,
  mode: consentPolicies.mode,
  policyVersion: consentPolicies.policyVersion,
  repromptAfterDays: consentPolicies.repromptAfterDays,
  payEntitlement: consentPolicies.payEntitlement,
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
  const [policy, activeInstallations, onSale] = await Promise.all([
    findPolicy(db, appId),
    db.$count(installations, and(eq(installations.appId, appId), gt(installations.lastSeenAt, since))),
    entitlementsOnSale(appId),
  ]);
  return {
    policy,
    activeInstallations,
    // What consent_or_pay can offer instead of consent
    entitlements: [...onSale].map(([key, stores]) => ({ key, stores })),
  };
}

// Creates the app's policy, versioned from today, or changes it. A new mode is
// a different consent screen, so it publishes a new version and everyone is
// asked again; the reprompt interval and the entitlement do not.
export async function saveConsentPolicy(
  actor: Actor,
  app: AdminApp,
  input: ConsentPolicyInput,
  now: Date = new Date(),
) {
  // consent_or_pay with nothing to buy would be "consent or leave"
  if (input.mode === 'consent_or_pay') {
    const onSale = await entitlementsOnSale(app.id);
    if (!input.payEntitlement || !onSale.has(input.payEntitlement)) {
      throw new AppError(409, 'entitlement_not_on_sale', 'Choose an entitlement granted by a product on sale');
    }
  }

  return db.transaction(async (tx) => {
    const before = await findPolicy(tx, app.id);
    const payEntitlement =
      input.mode === 'consent_or_pay' ? (input.payEntitlement ?? null) : (before?.payEntitlement ?? null);

    if (!before) {
      const values = {
        region: APP_REGION,
        mode: input.mode,
        policyVersion: nextPolicyVersion(null, now),
        repromptAfterDays: input.repromptAfterDays,
        payEntitlement,
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

    const modeChanged = before.mode !== input.mode;
    if (
      !modeChanged &&
      before.repromptAfterDays === input.repromptAfterDays &&
      before.payEntitlement === payEntitlement
    ) {
      return before;
    }

    const after = {
      mode: input.mode,
      repromptAfterDays: input.repromptAfterDays,
      payEntitlement,
      policyVersion: modeChanged ? nextPolicyVersion(before.policyVersion, now) : before.policyVersion,
    };
    const [updated] = await tx
      .update(consentPolicies)
      .set(after)
      .where(eq(consentPolicies.id, before.id))
      .returning(policyColumns);
    await writeAudit(
      {
        adminId: actor.adminId,
        action: 'consent_policy.update',
        appId: app.id,
        targetType: 'consent_policy',
        targetId: before.id,
        before: {
          mode: before.mode,
          repromptAfterDays: before.repromptAfterDays,
          payEntitlement: before.payEntitlement,
          policyVersion: before.policyVersion,
        },
        after,
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