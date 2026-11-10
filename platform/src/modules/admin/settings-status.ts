import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { appPlatforms, consentPolicies, identityKeys, oauthClients } from '../apps/schema.js';
import { entitlementsOnSale } from '../billing/catalog.js';
import { parameterSchemas } from '../config/schema.js';
import { trackingPlans } from '../events/schema.js';
import { deliveries, endpoints } from '../webhooks/schema.js';
import type { AdminApp } from './apps-service.js';
import { listVisibleApps } from './apps-service.js';
import type { AdminSession } from './service.js';

// configured: done; not_configured: needed before release;
// optional: depends on what the app needs; error: something is broken
export type TabStatus = 'configured' | 'not_configured' | 'optional' | 'error';
export interface TabState {
  status: TabStatus;
  hint: string;
}

const HOUR_MS = 60 * 60 * 1000;
// Undelivered notifications older than this no longer mark the tab:
// a long-fixed problem should not stay red forever
const FAILING_WINDOW_MS = 7 * 24 * HOUR_MS;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// One state per tab of App settings, for the dots and the setup checklist
export async function getSettingsStatus(app: AdminApp, now: Date = new Date()): Promise<Record<string, TabState>> {
  const appId = app.id;
  const [platforms, clients, activeKeys, [policy], plans, schemas, onSale, [endpoint], failing] = await Promise.all([
    db.$count(appPlatforms, eq(appPlatforms.appId, appId)),
    db.$count(oauthClients, eq(oauthClients.appId, appId)),
    db.$count(identityKeys, and(eq(identityKeys.appId, appId), isNull(identityKeys.revokedAt))),
    db
      .select({ mode: consentPolicies.mode, payEntitlement: consentPolicies.payEntitlement })
      .from(consentPolicies)
      .where(and(eq(consentPolicies.appId, appId), eq(consentPolicies.region, '*'))),
    db.$count(trackingPlans, eq(trackingPlans.appId, appId)),
    db.$count(parameterSchemas, eq(parameterSchemas.appId, appId)),
    entitlementsOnSale(appId),
    db.select({ url: endpoints.url }).from(endpoints).where(eq(endpoints.appId, appId)),
    // Tried and still undelivered an hour later
    db.$count(
      deliveries,
      and(
        eq(deliveries.appId, appId),
        isNull(deliveries.deliveredAt),
        gt(deliveries.attempts, 0),
        lt(deliveries.createdAt, new Date(now.getTime() - HOUR_MS)),
        gt(deliveries.createdAt, new Date(now.getTime() - FAILING_WINDOW_MS)),
      ),
    ),
  ]);

  const payOnSale = policy?.payEntitlement ? onSale.has(policy.payEntitlement) : false;

  return {
    general:
      app.status === 'disabled'
        ? { status: 'error', hint: 'Disabled: the app does not work for anyone' }
        : { status: 'configured', hint: 'Active' },
    platforms:
      platforms === 0
        ? { status: 'not_configured', hint: 'Add the Android package name or the iOS bundle ID' }
        : { status: 'configured', hint: plural(platforms, 'platform', 'platforms') },
    'sign-in':
      clients + activeKeys === 0
        ? { status: 'optional', hint: 'Anonymous sign-in works without it' }
        : {
            status: 'configured',
            hint: `${plural(clients, 'client', 'clients')}, ${plural(activeKeys, 'backend key', 'backend keys')}`,
          },
    consents: !policy
      ? { status: 'not_configured', hint: 'Everyone gets the default consent screen' }
      : policy.mode === 'consent_or_pay' && !payOnSale
        ? { status: 'error', hint: `${policy.payEntitlement} is not on sale: works as optional` }
        : { status: 'configured', hint: policy.mode },
    events:
      plans === 0
        ? { status: 'not_configured', hint: 'Upload tracking_plan.json' }
        : { status: 'configured', hint: 'Tracking plan uploaded' },
    config:
      schemas === 0
        ? { status: 'optional', hint: 'Only for apps with remote config' }
        : { status: 'configured', hint: 'Parameters declared' },
    subscriptions:
      onSale.size === 0
        ? { status: 'optional', hint: 'Only for apps that sell subscriptions' }
        : { status: 'configured', hint: plural(onSale.size, 'entitlement on sale', 'entitlements on sale') },
    webhooks: !endpoint
      ? { status: 'optional', hint: 'Only for apps with a backend' }
      : failing > 0
        ? { status: 'error', hint: `${plural(failing, 'notification', 'notifications')} not delivered` }
        : { status: 'configured', hint: 'Delivering' },
  };
}

// Every app the admin can see with the state of its settings, for Overview
export async function getAppsOverview(session: AdminSession) {
  const visible = await listVisibleApps(session);
  return Promise.all(visible.map(async (app) => ({ ...app, tabs: await getSettingsStatus(app) })));
}