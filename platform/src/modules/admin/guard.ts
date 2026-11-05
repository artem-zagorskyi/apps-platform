import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../core/errors.js';
import { authenticate, type AdminSession, type ClientInfo } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    // Set by requireAdmin on admin routes, null everywhere else
    admin: AdminSession | null;
  }
}

const BEARER = /^Bearer\s+(\S+)$/i;

// preHandler for admin routes: the Next.js server forwards the session token
// from the browser cookie as a bearer token
export async function requireAdmin(request: FastifyRequest): Promise<void> {
  const token = request.headers.authorization?.match(BEARER)?.[1];

  if (!token) {
    throw new AppError(401, 'unauthorized', 'Missing or malformed session token', 'no_bearer_token');
  }

  const session = await authenticate(token);

  if (!session) {
    throw new AppError(401, 'session_expired', 'Session is invalid or expired', 'no_live_session');
  }

  request.admin = session;
}

// Session of the current request. Only valid on routes with requireAdmin.
export function adminOf(request: FastifyRequest): AdminSession {
  if (!request.admin) {
    throw new Error('adminOf() called on a route without requireAdmin');
  }
  return request.admin;
}

const ipSchema = z.union([z.ipv4(), z.ipv6()]);

// The admin API only sees the Next.js container, so the browser's IP and
// user agent come in headers set by the Next.js server. Only that server
// can reach this port, so the headers are trusted; malformed values are
// dropped instead of failing the request.
export function clientOf(request: FastifyRequest): ClientInfo {
  const ip = ipSchema.safeParse(request.headers['x-client-ip']);
  const userAgent = request.headers['x-client-user-agent'];

  return {
    ip: ip.success ? ip.data : null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
  };
}