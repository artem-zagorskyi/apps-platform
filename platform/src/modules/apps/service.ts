import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../core/db.js';
import {
  appPlatforms,
  apps,
  type consentModeEnum,
  consentPolicies,
  oauthClients,
  type Platform,
} from './schema.js';

// True if the app exists, is active and has this platform registered
export async function isAppPlatformActive(
  appId: string,
  platform: Platform,
): Promise<boolean> {
  const rows = await db
    .select({ appId: apps.id })
    .from(apps)
    .innerJoin(appPlatforms, eq(appPlatforms.appId, apps.id))
    .where(
      and(
        eq(apps.id, appId),
        eq(apps.status, 'active'),
        eq(appPlatforms.platform, platform),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

// Client IDs a provider token may be issued for ("aud") for this app.
// All platforms together: Android and iOS often share one server client ID.
export async function getOAuthClientIds(
  appId: string,
  provider: 'google' | 'apple',
): Promise<string[]> {
  const rows = await db
    .select({ clientId: oauthClients.clientId })
    .from(oauthClients)
    .where(and(eq(oauthClients.appId, appId), eq(oauthClients.provider, provider)));

  return rows.map((row) => row.clientId);
}

export type ConsentMode = (typeof consentModeEnum.enumValues)[number];

export interface ConsentPolicy {
  region: string;
  mode: ConsentMode;
  policyVersion: string;
  repromptAfterDays: number;
}

// Used when an app has no policy at all: the strictest behaviour, ask everyone
const FALLBACK_POLICY: ConsentPolicy = {
  region: '*',
  mode: 'optional',
  policyVersion: '0',
  repromptAfterDays: 180,
};

// Consent policy for a country: the exact country first, then the "*" default.
// country is null while the country is unknown.
export async function getConsentPolicy(
  appId: string,
  country: string | null,
): Promise<{ policy: ConsentPolicy; configured: boolean }> {
  const regions = country ? [country, '*'] : ['*'];
  const rows = await db
    .select({
      region: consentPolicies.region,
      mode: consentPolicies.mode,
      policyVersion: consentPolicies.policyVersion,
      repromptAfterDays: consentPolicies.repromptAfterDays,
    })
    .from(consentPolicies)
    .where(and(eq(consentPolicies.appId, appId), inArray(consentPolicies.region, regions)));

  const policy =
    rows.find((row) => row.region === country) ?? rows.find((row) => row.region === '*');

  return policy ? { policy, configured: true } : { policy: FALLBACK_POLICY, configured: false };
}