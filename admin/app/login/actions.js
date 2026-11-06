'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminApiError, SESSION_COOKIE, adminApi } from '@/lib/admin-api';

// Messages for the sign-in form. A wrong email, password or code all get
// the same answer, like in the API.
function errorMessage(err) {
  if (err.code === 'account_locked') {
    return 'Too many failed attempts. The account is locked for 15 minutes.';
  }
  if (err.status === 429) {
    return 'Too many attempts from this address. Wait a minute and try again.';
  }
  if (err.status === 401 || err.status === 400) {
    return 'Wrong email, password or code.';
  }
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
    const message = err instanceof AdminApiError ? errorMessage(err) : null;
    if (!message) throw err;
    // The email goes back so the form does not lose it
    return { error: message, email };
  }

  // Outside try: redirect() works by throwing
  redirect('/');
}