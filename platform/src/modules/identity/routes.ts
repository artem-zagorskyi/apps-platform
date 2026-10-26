import type { FastifyPluginAsync } from 'fastify';
import { publicJwks } from './tokens.js';

export const identityRoutes: FastifyPluginAsync = async (app) => {
  // Public keys for verifying access tokens, used by app backends.
  // Cached for an hour: keys change rarely and old ones stay listed during rotation.
  app.get('/.well-known/jwks.json', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=3600');
    return { keys: publicJwks };
  });
};