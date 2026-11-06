'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminApiError, SESSION_COOKIE, adminApi } from '@/lib/admin-api';

export async function signOut() {
  try {
    await adminApi('/auth/logout', { method: 'POST' });
  } catch (err) {
    // Already expired on the server: just forget it here too
    if (!(err instanceof AdminApiError && err.status === 401)) throw err;
  }

  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}