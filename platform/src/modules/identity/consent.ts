import { and, desc, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { type ConsentPolicy, getConsentPolicy } from '../apps/service.js';
import { type consentPurposeEnum, consents, installations, users } from './schema.js';
import type { AccessTokenClaims } from './tokens.js';

export type ConsentPurpose = (typeof consentPurposeEnum.enumValues)[number];

// Purposes on the platform's own consent screen.
// Ads consent comes later through Google UMP.
export const SCREEN_PURPOSES = ['analytics', 'personalization'] as const;
export type ScreenPurpose = (typeof SCREEN_PURPOSES)[number];

export type ConsentSource = 'first_launch' | 'reprompt' | 'settings';
export type ConsentStatus = 'needs_decision' | 'decided' | 'not_required';

export interface ConsentDecision {
  purpose: ConsentPurpose;
  granted: boolean;
  policyVersion: string;
  decidedAt: string; // ISO 8601
}

export interface ConsentState {
  policy: { region: string; mode: ConsentPolicy['mode']; version: string };
  status: ConsentStatus;
  decisions: ConsentDecision[];
  // When the app may ask again after a refusal; null without refusals
  canAskAgainAt: string | null;
}

export interface RecordConsentInput {
  decisions: Partial<Record<ScreenPurpose, boolean>>;
  policyVersion: string;
  source: ConsentSource;
  decidedAt: Date; // device clock
  sentAt: Date; // device clock when the request was sent
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Consent is given by an active user on a device that still belongs to them
async function requireOwner(auth: AccessTokenClaims): Promise<void> {
  const [row] = await db
    .select({ status: users.status, ownerId: installations.userId })
    .from(users)
    .innerJoin(installations, eq(installations.id, auth.installationId))
    .where(and(eq(users.id, auth.userId), eq(users.appId, auth.appId)));

  if (row?.status !== 'active') {
    throw new AppError(401, 'unauthorized', 'Account is no longer active', `user_${row?.status ?? 'missing'}`);
  }
  if (row.ownerId !== auth.userId) {
    throw new AppError(401, 'unauthorized', 'Device no longer belongs to this user', 'installation_reassigned');
  }
}

async function loadPolicy(appId: string, log: FastifyBaseLogger): Promise<ConsentPolicy> {
  // The country is not known yet (GeoIP comes with events): the "*" policy applies
  const { policy, configured } = await getConsentPolicy(appId, null);
  if (!configured) log.warn({ appId }, 'no consent policy configured, asking everyone');
  return policy;
}

// The latest decision per purpose, by the time it was made
async function latestDecisions(userId: string): Promise<ConsentDecision[]> {
  const rows = await db
    .select({
      purpose: consents.purpose,
      granted: consents.granted,
      policyVersion: consents.policyVersion,
      createdAt: consents.createdAt,
    })
    .from(consents)
    .where(eq(consents.userId, userId))
    .orderBy(desc(consents.createdAt), desc(consents.id));

  const latest = new Map<ConsentPurpose, ConsentDecision>();
  for (const row of rows) {
    if (latest.has(row.purpose)) continue;
    latest.set(row.purpose, {
      purpose: row.purpose,
      granted: row.granted,
      policyVersion: row.policyVersion,
      decidedAt: row.createdAt.toISOString(),
    });
  }
  return [...latest.values()];
}

function evaluate(
  policy: ConsentPolicy,
  decisions: ConsentDecision[],
): Pick<ConsentState, 'status' | 'canAskAgainAt'> {
  if (policy.mode === 'none') return { status: 'not_required', canAskAgainAt: null };

  // optional and consent_or_pay both need a decision for the current policy version
  let lastRefusal: number | null = null;
  for (const purpose of SCREEN_PURPOSES) {
    const decision = decisions.find(
      (d) => d.purpose === purpose && d.policyVersion === policy.policyVersion,
    );
    if (!decision) return { status: 'needs_decision', canAskAgainAt: null };
    if (!decision.granted) {
      lastRefusal = Math.max(lastRefusal ?? 0, Date.parse(decision.decidedAt));
    }
  }

  return {
    status: 'decided',
    canAskAgainAt:
      lastRefusal === null
        ? null
        : new Date(lastRefusal + policy.repromptAfterDays * DAY_MS).toISOString(),
  };
}

export async function getConsentState(
  auth: AccessTokenClaims,
  log: FastifyBaseLogger,
): Promise<ConsentState> {
  await requireOwner(auth);
  const policy = await loadPolicy(auth.appId, log);
  const decisions = await latestDecisions(auth.userId);

  return {
    policy: { region: policy.region, mode: policy.mode, version: policy.policyVersion },
    decisions,
    ...evaluate(policy, decisions),
  };
}

// Appends one log row per decided purpose and returns the new state
export async function recordConsent(
  auth: AccessTokenClaims,
  input: RecordConsentInput,
  log: FastifyBaseLogger,
): Promise<ConsentState> {
  await requireOwner(auth);
  const policy = await loadPolicy(auth.appId, log);

  // Shift the device time by the device clock error, never into the future
  const now = Date.now();
  const clockSkew = now - input.sentAt.getTime();
  const decidedAt = new Date(Math.min(input.decidedAt.getTime() + clockSkew, now));

  const rows = SCREEN_PURPOSES.flatMap((purpose) => {
    const granted = input.decisions[purpose];
    if (granted === undefined) return [];
    return [
      {
        appId: auth.appId,
        userId: auth.userId,
        installationId: auth.installationId,
        purpose,
        granted,
        policyVersion: input.policyVersion,
        region: policy.region,
        source: input.source,
        createdAt: decidedAt,
      },
    ];
  });

  await db.insert(consents).values(rows);
  return getConsentState(auth, log);
}