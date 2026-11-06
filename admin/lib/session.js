import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminApiError, SESSION_COOKIE, adminApi } from './admin-api';

// The signed-in admin, or null. Asked once per page render, however many
// components need it (React cache lasts for one request).
export const getSession = cache(async () => {
  if (!(await cookies()).get(SESSION_COOKIE)) {
    return null;
  }

  try {
    return await adminApi('/auth/session');
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) {
      return null;
    }
    throw err;
  }
});

// For pages of the panel: the session, or a redirect to the sign-in page
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  return session;
}