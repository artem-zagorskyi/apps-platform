import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../core/errors.js';
import { adminOf, clientOf, requireAdmin } from './guard.js';
import { listSessions, login, logout, revokeOtherSessions } from './service.js';

const loginBody = z.object({
  email: z.string().min(1).max(320),
  // Capped so a huge body cannot keep Argon2 busy
  password: z.string().min(1).max(1024),
  code: z.string().min(1).max(64), // TOTP or recovery code
});

export async function adminAuthRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/auth/login',
    {
      schema: { body: loginBody },
      config: {
        // The account lock stops guessing one password; this limit stops
        // trying many emails from one browser. Keyed by the browser IP,
        // since every request comes from the same Next.js container.
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (request) => clientOf(request).ip ?? 'unknown',
        },
      },
    },
    async (request) => {
      const result = await login(request.body, clientOf(request));

      if (!result.ok) {
        if (result.reason === 'locked') {
          throw new AppError(
            423,
            'account_locked',
            `Too many failed attempts, try again after ${result.lockedUntil.toISOString()}`,
          );
        }
        throw new AppError(401, 'invalid_credentials', 'Email, password or code is wrong');
      }

      return {
        token: result.token,
        expiresAt: result.expiresAt,
        remainingRecoveryCodes: result.remainingRecoveryCodes,
      };
    },
  );

  app.post('/auth/logout', { preHandler: requireAdmin }, async (request, reply) => {
    await logout(adminOf(request), clientOf(request));
    return reply.code(204).send();
  });

  // Who is signed in; the panel calls it on every page load
  app.get('/auth/session', { preHandler: requireAdmin }, async (request) => {
    const { adminId, email, roles } = adminOf(request);
    return { adminId, email, roles };
  });

  app.get('/auth/sessions', { preHandler: requireAdmin }, async (request) => ({
    sessions: await listSessions(adminOf(request)),
  }));

  app.post('/auth/sessions/revoke-others', { preHandler: requireAdmin }, async (request) => ({
    revoked: await revokeOtherSessions(adminOf(request), clientOf(request)),
  }));
}