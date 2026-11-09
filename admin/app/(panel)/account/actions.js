'use server';

import { revalidatePath } from 'next/cache';
import { adminApi } from '@/lib/admin-api';
import { runAction } from '@/lib/actions';

export async function revokeOtherSessions() {
  return runAction(async () => {
    await adminApi('/auth/sessions/revoke-others', { method: 'POST' });
    revalidatePath('/account');
  });
}