'use server';

import { revalidatePath } from 'next/cache';
import { adminApi } from '@/lib/admin-api';
import { runAction } from '@/lib/actions';

// Bound arguments (slug, platform) come back from the browser and could be
// changed there; the admin API checks access for whatever arrives.
function appPath(slug) {
  return `/apps/${encodeURIComponent(slug)}`;
}

// App names and states also show in the sidebar, so the whole panel is refreshed
function refreshPanel() {
  revalidatePath('/', 'layout');
}

export async function renameApp(slug, _previous, formData) {
  return runAction(async () => {
    await adminApi(appPath(slug), { method: 'PATCH', body: { name: String(formData.get('name') ?? '') } });
    refreshPanel();
  });
}

// Called from the confirmation dialog with the reason typed there
export async function disableApp(slug, reason) {
  return runAction(async () => {
    await adminApi(appPath(slug), { method: 'PATCH', body: { status: 'disabled', reason } });
    refreshPanel();
  });
}

export async function enableApp(slug) {
  return runAction(async () => {
    await adminApi(appPath(slug), { method: 'PATCH', body: { status: 'active' } });
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

function refreshSignIn(slug) {
  revalidatePath(`/apps/${encodeURIComponent(slug)}/settings/sign-in`);
}

export async function addOAuthClient(slug, _previous, formData) {
  return runAction(async () => {
    await adminApi(`${appPath(slug)}/oauth-clients`, {
      method: 'POST',
      body: {
        provider: String(formData.get('provider') ?? ''),
        platform: String(formData.get('platform') ?? ''),
        clientId: String(formData.get('clientId') ?? '').trim(),
      },
    });
    refreshSignIn(slug);
  });
}

// Called from the confirmation dialog
export async function removeOAuthClient(slug, clientId) {
  return runAction(async () => {
    await adminApi(`${appPath(slug)}/oauth-clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
    refreshSignIn(slug);
  });
}

// Returns the private key once, for the form to show
export async function createBackendKey(slug) {
  return runAction(async () => {
    const key = await adminApi(`${appPath(slug)}/identity-keys`, { method: 'POST' });
    refreshSignIn(slug);
    return key;
  });
}

// Called from the confirmation dialog with the reason typed there
export async function revokeBackendKey(slug, kid, reason) {
  return runAction(async () => {
    await adminApi(`${appPath(slug)}/identity-keys/${encodeURIComponent(kid)}/revoke`, {
      method: 'POST',
      body: { reason },
    });
    refreshSignIn(slug);
  });
}

function refreshConsents(slug) {
  revalidatePath(`/apps/${encodeURIComponent(slug)}/settings/consents`);
}

// Creates the app's policy if there is none, otherwise changes its mode and
// reprompt interval (which does not ask anyone again)
export async function saveConsentPolicy(slug, _previous, formData) {
  return runAction(async () => {
    await adminApi(`${appPath(slug)}/consent-policy`, {
      method: 'PUT',
      body: {
        mode: String(formData.get('mode') ?? ''),
        repromptAfterDays: Number(formData.get('repromptAfterDays')),
      },
    });
    refreshConsents(slug);
  });
}

// Called from the confirmation dialog with the reason typed there
export async function newConsentVersion(slug, reason) {
  return runAction(async () => {
    await adminApi(`${appPath(slug)}/consent-policy/new-version`, { method: 'POST', body: { reason } });
    refreshConsents(slug);
  });
}