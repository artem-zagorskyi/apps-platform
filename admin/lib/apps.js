import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { AdminApiError, adminApi } from './admin-api';


// Apps the signed-in admin may see, once per request
export const getVisibleApps = cache(async () => (await adminApi('/apps')).apps);

async function readApp(slug, suffix = '') {
  try {
    return await adminApi(`/apps/${encodeURIComponent(slug)}${suffix}`);
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) {
      // The session ended (30 minutes idle or 12 hours): sign in again
      redirect('/login');
    }
    if (err instanceof AdminApiError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
}

export const getApp = cache((slug) => readApp(slug));
export const getSignInSettings = cache((slug) => readApp(slug, '/sign-in'));
export const getConsentSettings = cache((slug) => readApp(slug, '/consent-policy'));
export const getWebhookSettings = cache((slug) => readApp(slug, '/webhook'));
export const getTrackingPlan = cache((slug) => readApp(slug, '/tracking-plan'));
export const getConfigSchema = cache((slug) => readApp(slug, '/config-schema'));
export const getCatalog = cache((slug) => readApp(slug, '/catalog'));
export const getSettingsStatus = cache((slug) => readApp(slug, '/settings-status'));
export const getOverview = cache(async () => (await adminApi('/overview')).apps);
export const getConfigOverview = cache((slug) => readApp(slug, '/config'));