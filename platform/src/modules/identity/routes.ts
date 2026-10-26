import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { platformEnum } from '../apps/schema.js';
import { signUpAnonymous, refreshSession } from './service.js';
import { publicJwks } from './tokens.js';

const anonymousSignUpBody = z.object({
  appId: z.uuid(),
  installationId: z.uuid(),
  platform: z.enum(platformEnum.enumValues),
  appVersion: z.string().min(1).max(32),
  appBuild: z.string().min(1).max(32),
  osVersion: z.string().min(1).max(64),
});

const refreshBody = z.object({
  refreshToken: z.string().min(20).max(200),
});

const tokenPairResponse = z.object({
  userId: z.uuid(),
  accessToken: z.string(),
  accessTokenExpiresIn: z.number().int(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.iso.datetime(),
});

export const identityRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public keys for verifying access tokens, used by app backends.
  // Cached for an hour: keys change rarely and old ones stay listed during rotation.
  app.get('/.well-known/jwks.json', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=3600');
    return { keys: publicJwks };
  });

  // First launch of an installation: create an anonymous user and issue tokens
  app.post(
    '/v1/auth/anonymous',
    {
      schema: {
        body: anonymousSignUpBody,
        response: { 201: tokenPairResponse },
      },
      // Per IP, to stop mass creation of accounts
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const tokens = await signUpAnonymous(request.body);
      return reply.code(201).send(tokens);
    },
  );

    // Exchange a refresh token for a new token pair
  app.post(
    '/v1/auth/refresh',
    {
      schema: {
        body: refreshBody,
        response: { 200: tokenPairResponse },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request) => refreshSession(request.body.refreshToken),
  );
};