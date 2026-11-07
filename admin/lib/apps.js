import 'server-only';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { AdminApiError, adminApi } from './admin-api';

// Apps the signed-in admin may see, once per request
export const getVisibleApps = cache(async () => (await adminApi('/apps')).apps);

// One app with its platforms. No access looks like no app.
export const getApp = cache(async (slug) => {
  try {
    return await adminApi(`/apps/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err instanceof AdminApiError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
});