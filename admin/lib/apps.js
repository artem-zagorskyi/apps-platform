import 'server-only';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { AdminApiError, adminApi } from './admin-api';

// Apps the signed-in admin may see, once per request
export const getVisibleApps = cache(async () => (await adminApi('/apps')).apps);

// Reads something of one app. No access looks like no app.
async function readApp(slug, suffix = '') {
  try {
    return await adminApi(`/apps/${encodeURIComponent(slug)}${suffix}`);
  } catch (err) {
    if (err instanceof AdminApiError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
}

export const getApp = cache((slug) => readApp(slug));
export const getSignInSettings = cache((slug) => readApp(slug, '/sign-in'));