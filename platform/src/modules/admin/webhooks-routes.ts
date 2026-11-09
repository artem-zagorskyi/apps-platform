import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getWebhookOverview, sendTestWebhook } from '../webhooks/service.js';
import { findAppForAdmin } from './apps-service.js';
import { actorOf, adminOf, requireAdmin } from './guard.js';
import { SETTINGS_EDITORS, SETTINGS_READERS } from './roles.js';
import { removeWebhook, rotateWebhookSecret, setWebhookUrl } from './webhooks-service.js';

const slugParams = z.object({ slug: z.string().min(1).max(64) });
const reasonBody = z.object({ reason: z.string().trim().min(1).max(500) });

export async function adminWebhookRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // Every route here needs a signed-in admin
  app.addHook('preHandler', requireAdmin);

  app.get('/apps/:slug/webhook', { schema: { params: slugParams } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_READERS);
    return getWebhookOverview(found.id);
  });

  app.put(
    '/apps/:slug/webhook',
    { schema: { params: slugParams, body: z.object({ url: z.string().trim().min(1).max(2000) }) } },
    async (request, reply) => {
      const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_EDITORS);
      const result = await setWebhookUrl(actorOf(request), found, request.body.url);
      // The secret of a new endpoint must not stay in any cache on the way
      return reply.header('cache-control', 'no-store').send(result);
    },
  );

  app.post('/apps/:slug/webhook/rotate-secret', { schema: { params: slugParams } }, async (request, reply) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_EDITORS);
    const secret = await rotateWebhookSecret(actorOf(request), found);
    return reply.header('cache-control', 'no-store').send({ secret });
  });

  app.post('/apps/:slug/webhook/test', { schema: { params: slugParams } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_EDITORS);
    return sendTestWebhook(found.id);
  });

  app.delete(
    '/apps/:slug/webhook',
    { schema: { params: slugParams, body: reasonBody } },
    async (request, reply) => {
      const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_EDITORS);
      await removeWebhook(actorOf(request), found, request.body.reason);
      return reply.code(204).send();
    },
  );
}