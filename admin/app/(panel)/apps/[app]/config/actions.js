'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { AdminApiError, adminApi } from '@/lib/admin-api';

const configPath = (slug) => `/apps/${encodeURIComponent(slug)}/config`;

// { ok, data } or { error, code }: the page shows errors without throwing
async function act(slug, request) {
  try {
    const data = await request();
    revalidatePath(`/apps/${encodeURIComponent(slug)}/config`, 'layout');
    return { ok: true, data };
  } catch (err) {
    if (err instanceof AdminApiError) {
      if (err.status === 401) redirect('/login');
      return { error: err.message, code: err.code ?? null };
    }
    throw err;
  }
}

// { document, baseVersion, expectedUpdatedAt }
export async function saveConfigDraft(slug, draft) {
  return act(slug, () => adminApi(`${configPath(slug)}/draft`, { method: 'PUT', body: draft }));
}

export async function discardConfigDraft(slug) {
  return act(slug, () => adminApi(`${configPath(slug)}/draft`, { method: 'DELETE' }));
}

export async function rebaseConfigDraft(slug) {
  return act(slug, () => adminApi(`${configPath(slug)}/draft/rebase`, { method: 'POST' }));
}

export async function publishConfigDraft(slug, comment) {
  return act(slug, () => adminApi(`${configPath(slug)}/publish`, { method: 'POST', body: { comment } }));
}

// An old version's parameters into the draft; replace: overwrite an existing draft
export async function restoreConfigVersion(slug, version, replace) {
  return act(slug, () =>
    adminApi(`${configPath(slug)}/versions/${version}/restore`, { method: 'POST', body: { replace: Boolean(replace) } }),
  );
}
