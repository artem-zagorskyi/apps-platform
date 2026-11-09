import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { checkParameterSchema, getParameterSchemaOverview } from '../config/schemas-service.js';
import { getHoldout } from '../config/versions-service.js';
import { findAppForAdmin } from './apps-service.js';
import { setHoldout, uploadParameterSchema } from './config-service.js';
import { actorOf, adminOf, requireAdmin } from './guard.js';
import { PRODUCT_EDITORS, SETTINGS_READERS } from './roles.js';

const slugParams = z.object({ slug: z.string().min(1).max(64) });
// The schema is checked by the config module, which reports every problem at once
const schemaBody = z.object({ schema: z.unknown() });

export async function adminConfigRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // Every route here needs a signed-in admin
  app.addHook('preHandler', requireAdmin);

  app.get('/apps/:slug/config-schema', { schema: { params: slugParams } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_READERS);
    const [overview, holdout] = await Promise.all([getParameterSchemaOverview(found.id), getHoldout(found.id)]);
    return { ...overview, holdout };
  });

  // Nothing is stored: what an upload of this schema would do
  app.post(
    '/apps/:slug/config-schema/check',
    { schema: { params: slugParams, body: schemaBody } },
    async (request) => {
      const found = await findAppForAdmin(adminOf(request), request.params.slug, PRODUCT_EDITORS);
      return checkParameterSchema(found.id, request.body.schema);
    },
  );

  app.post(
    '/apps/:slug/config-schema',
    { schema: { params: slugParams, body: schemaBody } },
    async (request, reply) => {
      const session = adminOf(request);
      const found = await findAppForAdmin(session, request.params.slug, PRODUCT_EDITORS);
      const result = await uploadParameterSchema(actorOf(request), session.email, found, request.body.schema);
      return reply.code(result.status === 'created' ? 201 : 200).send(result);
    },
  );

  app.put(
    '/apps/:slug/holdout',
    { schema: { params: slugParams, body: z.object({ percent: z.number().min(0).max(50) }) } },
    async (request) => {
      const session = adminOf(request);
      const found = await findAppForAdmin(session, request.params.slug, PRODUCT_EDITORS);
      return setHoldout(actorOf(request), session.email, found, request.body.percent);
    },
  );
}