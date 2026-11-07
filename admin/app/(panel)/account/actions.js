'use server';

import { revalidatePath } from 'next/cache';
import { adminApi } from '@/lib/admin-api';

export async function revokeOtherSessions() {
  await adminApi('/auth/sessions/revoke-others', { method: 'POST' });
  revalidatePath('/account');
}