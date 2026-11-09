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

// Creates the app's policy if there is none, otherwise changes it.
// A new mode publishes a new policy version on the server.
export async function saveConsentPolicy(slug, _previous, formData) {
  return runAction(async () => {
    const payEntitlement = formData.get('payEntitlement');
    await adminApi(`${appPath(slug)}/consent-policy`, {
      method: 'PUT',
      body: {
        mode: String(formData.get('mode') ?? ''),
        repromptAfterDays: Number(formData.get('repromptAfterDays')),
        payEntitlement: payEntitlement ? String(payEntitlement) : null,
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

function refreshWebhooks(slug) {
  revalidatePath(`/apps/${encodeURIComponent(slug)}/settings/webhooks`);
}

// Returns { secret, requeued }: a secret only when the endpoint is new
export async function setWebhookUrl(slug, _previous, formData) {
  return runAction(async () => {
    const result = await adminApi(`${appPath(slug)}/webhook`, {
      method: 'PUT',
      body: { url: String(formData.get('url') ?? '').trim() },
    });
    refreshWebhooks(slug);
    return result;
  });
}

// Returns { secret } once
export async function rotateWebhookSecret(slug) {
  return runAction(async () => {
    const result = await adminApi(`${appPath(slug)}/webhook/rotate-secret`, { method: 'POST' });
    refreshWebhooks(slug);
    return result;
  });
}

// Returns { ok, httpStatus, ms, error }; nothing is stored
export async function sendTestWebhook(slug) {
  return runAction(() => adminApi(`${appPath(slug)}/webhook/test`, { method: 'POST' }));
}

// Called from the confirmation dialog with the reason typed there
export async function removeWebhookUrl(slug, reason) {
  return runAction(async () => {
    await adminApi(`${appPath(slug)}/webhook`, { method: 'DELETE', body: { reason } });
    refreshWebhooks(slug);
  });
}

// Uploaded files are parsed here, so a file that is not JSON gets a clear message
function parseJsonFile(text) {
  try {
    return { json: JSON.parse(text) };
  } catch (err) {
    return { error: `Not a JSON file: ${err.message}` };
  }
}

function refreshEvents(slug) {
  revalidatePath(`/apps/${encodeURIComponent(slug)}/settings/events`);
}

// What uploading the file would do; nothing is stored
export async function checkTrackingPlan(slug, text) {
  const file = parseJsonFile(text);
  if (file.error) return { error: file.error };
  return runAction(() =>
    adminApi(`${appPath(slug)}/tracking-plan/check`, { method: 'POST', body: { plan: file.json } }),
  );
}

// Returns { status: 'created' | 'unchanged', version, events, summary }
export async function uploadTrackingPlan(slug, text) {
  const file = parseJsonFile(text);
  if (file.error) return { error: file.error };
  return runAction(async () => {
    const result = await adminApi(`${appPath(slug)}/tracking-plan`, { method: 'POST', body: { plan: file.json } });
    refreshEvents(slug);
    return result;
  });
}

function refreshConfig(slug) {
  revalidatePath(`/apps/${encodeURIComponent(slug)}/settings/config`);
}

// What uploading the file would do; nothing is stored
export async function checkParameterSchema(slug, text) {
  const file = parseJsonFile(text);
  if (file.error) return { error: file.error };
  return runAction(() =>
    adminApi(`${appPath(slug)}/config-schema/check`, { method: 'POST', body: { schema: file.json } }),
  );
}

// Returns { status: 'created' | 'unchanged', version, parameters, summary }
export async function uploadParameterSchema(slug, text) {
  const file = parseJsonFile(text);
  if (file.error) return { error: file.error };
  return runAction(async () => {
    const result = await adminApi(`${appPath(slug)}/config-schema`, { method: 'POST', body: { schema: file.json } });
    refreshConfig(slug);
    return result;
  });
}

// Publishes a new config version with only the holdout changed
export async function setHoldout(slug, _previous, formData) {
  return runAction(async () => {
    await adminApi(`${appPath(slug)}/holdout`, {
      method: 'PUT',
      body: { percent: Number(formData.get('percent')) },
    });
    refreshConfig(slug);
  });
}

function refreshSubscriptions(slug) {
  revalidatePath(`/apps/${encodeURIComponent(slug)}/settings/subscriptions`);
}

// What uploading the file would do; nothing is stored
export async function checkCatalog(slug, text) {
  const file = parseJsonFile(text);
  if (file.error) return { error: file.error };
  return runAction(() =>
    adminApi(`${appPath(slug)}/catalog/check`, { method: 'POST', body: { catalog: file.json } }),
  );
}

// Returns { status: 'created' | 'unchanged', version, summary, added, updated, archived, unchanged }
export async function uploadCatalog(slug, text) {
  const file = parseJsonFile(text);
  if (file.error) return { error: file.error };
  return runAction(async () => {
    const result = await adminApi(`${appPath(slug)}/catalog`, { method: 'POST', body: { catalog: file.json } });
    refreshSubscriptions(slug);
    return result;
  });
}