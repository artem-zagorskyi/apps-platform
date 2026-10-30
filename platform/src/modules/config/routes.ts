import { createHash } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { countryOf } from '../../core/geoip.js';
import { authOf, requireAuth } from '../identity/auth.js';
import { getMe } from '../identity/service.js';
import { canonicalJson } from './document.js';
import { evaluateConfig } from './evaluate.js';
import { getActiveConfig } from './versions-service.js';

const configQuery = z.object({
  // The running app version: it may be newer than the one at sign-up
  appVersion: z.string().min(1).max(32),
});

const configResponse = z.object({
  version: z.number().int(),
  values: z.record(z.string(), z.unknown()),
  experiments: z.array(
    z.object({
      key: z.string(),
      variant: z.string(),
      parameters: z.array(z.string()),
      forced: z.literal(true).optional(),
    }),
  ),
});

// If-None-Match may hold several tags, strong or weak (W/"...")
function notModified(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag);
}

export const configRoutes: FastifyPluginAsyncZod = async (app) => {
  // Config values and experiments of the current user
  app.get(
    '/v1/config',
    {
      preHandler: requireAuth,
      schema: {
        querystring: configQuery,
        response: { 200: configResponse, 304: z.void() },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const auth = authOf(request);
      // Also refuses users who are no longer active
      const me = await getMe(auth);

      const result = evaluateConfig(await getActiveConfig(auth.appId), {
        appId: auth.appId,
        userId: auth.userId,
        platform: auth.platform,
        appVersion: request.query.appVersion,
        country: countryOf(request.ip),
        linked: me.providers.length > 0,
        userCreatedAt: new Date(me.createdAt),
      });

      // Same values for the user -> same tag -> 304 without a body
      const hash = createHash('sha256').update(canonicalJson(result)).digest('hex');
      const etag = `"${hash.slice(0, 32)}"`;
      reply.header('etag', etag).header('cache-control', 'private, no-cache');

      if (notModified(request.headers['if-none-match'], etag)) return reply.code(304).send();
      return result;
    },
  );
};