import 'server-only';
import { cookies, headers } from 'next/headers';

export const SESSION_COOKIE = 'admin_session';

// Error answered by the admin API: { error, message } with an HTTP status
export class AdminApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
  }
}

// The admin API only sees this server, so the browser's IP and user agent
// are passed on for sessions and the audit log. In production the reverse
// proxy in front of the panel sets X-Forwarded-For.
async function clientHeaders() {
  const incoming = await headers();
  const forwarded = incoming.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || incoming.get('x-real-ip');
  const userAgent = incoming.get('user-agent');

  return {
    ...(ip && { 'x-client-ip': ip }),
    ...(userAgent && { 'x-client-user-agent': userAgent }),
  };
}

// Calls the admin API on behalf of the signed-in admin.
// `auth: false` only for sign-in, which has no session yet.
export async function adminApi(path, { method = 'GET', body, auth = true } = {}) {
  const baseUrl = process.env.ADMIN_API_URL;
  if (!baseUrl) {
    throw new Error('ADMIN_API_URL is not set');
  }

  const requestHeaders = await clientHeaders();

  if (auth) {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) {
      throw new AdminApiError(401, 'unauthorized', 'Not signed in');
    }
    requestHeaders.authorization = `Bearer ${token}`;
  }

  if (body !== undefined) {
    requestHeaders['content-type'] = 'application/json';
  }

  const response = await fetch(new URL(`/admin/v1${path}`, baseUrl), {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    // Admin data is always fresh and per admin, never cached by Next.js
    cache: 'no-store',
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new AdminApiError(
      response.status,
      data?.error ?? 'request_error',
      data?.message ?? response.statusText,
    );
  }

  return data;
}