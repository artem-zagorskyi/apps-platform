'use server';

import { revalidatePath } from 'next/cache';
import { adminApi } from '@/lib/admin-api';
import { runAction } from '@/lib/actions';

// Bound arguments (slug, platform) come back from the browser and could be
// changed there; the admin API checks access for whatever arrives.
function appPath(slug) {
  return `/apps/${encodeURIComponent(slug)}`;
}

// App names also show in the sidebar, so the whole panel is refreshed
function refreshPanel() {
  revalidatePath('/', 'layout');
}

export async function renameApp(slug, _previous, formData) {
  return runAction(async () => {
    await adminApi(appPath(slug), { method: 'PATCH', body: { name: String(formData.get('name') ?? '') } });
    refreshPanel();
  });
}

export async function setAppStatus(slug, status, _previous, formData) {
  const reason = String(formData.get('reason') ?? '').trim();
  return runAction(async () => {
    await adminApi(appPath(slug), { method: 'PATCH', body: { status, ...(reason && { reason }) } });
    refreshPanel();
  });
}

export async function setPlatform(slug, platform, _previous, formData) {
  return runAction(async () => {
    await adminApi(`${appPath(slug)}/platforms/${platform}`, {
      method: 'PUT',
      body: { bundleId: String(formData.get('bundleId') ?? '') },
    });
    refreshPanel();
  });
}