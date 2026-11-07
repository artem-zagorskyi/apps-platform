'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminApi } from '@/lib/admin-api';
import { runAction } from '@/lib/actions';

export async function createApp(_previous, formData) {
  let created = null;

  const result = await runAction(async () => {
    ({ app: created } = await adminApi('/apps', {
      method: 'POST',
      body: {
        name: String(formData.get('name') ?? ''),
        slug: String(formData.get('slug') ?? '').trim(),
      },
    }));
  });

  if (!created) {
    return result;
  }

  // The new app must appear in the switcher
  revalidatePath('/', 'layout');
  // Next step for a new app: its platforms
  redirect(`/apps/${created.slug}/settings/platforms`);
}