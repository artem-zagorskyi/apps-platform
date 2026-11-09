'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminApiError, SESSION_COOKIE, adminApi } from '@/lib/admin-api';

// What went wrong, for the notice above the form. A wrong email, password
// or code all get the same answer, like in the API.
function errorKind(err) {
  if (err.code === 'account_locked') return 'locked';
  if (err.status === 429) return 'rate';
  if (err.status === 401 || err.status === 400) return 'invalid';
  return null;
}

export async function signIn(_previousState, formData) {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const code = String(formData.get('code') ?? '');

  try {
    const session = await adminApi('/auth/login', {
      method: 'POST',
      body: { email, password, code },
      auth: false,
    });

    (await cookies()).set(SESSION_COOKIE, session.token, {
      httpOnly: true, // not readable by scripts on the page
      sameSite: 'strict', // not sent with requests started by other sites
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: new Date(session.expiresAt),
    });
  } catch (err) {
    const error = err instanceof AdminApiError ? errorKind(err) : null;
    if (!error) throw err;
    // The email goes back so the form does not lose it
    return { error, email };
  }

  // Outside try: redirect() works by throwing
  redirect('/');
}