import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { checkCatalog, getCatalogOverview } from '../billing/catalog.js';
import { findAppForAdmin } from './apps-service.js';
import { uploadCatalog } from './catalog-service.js';
import { actorOf, adminOf, requireAdmin } from './guard.js';
import { PRODUCT_EDITORS, SETTINGS_READERS } from './roles.js';

const slugParams = z.object({ slug: z.string().min(1).max(64) });
// The catalog is checked by the billing module, which reports every problem at once
const catalogBody = z.object({ catalog: z.unknown() });

export async function adminCatalogRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // Every route here needs a signed-in admin
  app.addHook('preHandler', requireAdmin);

  app.get('/apps/:slug/catalog', { schema: { params: slugParams } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_READERS);
    return getCatalogOverview(found.id);
  });

  // Nothing is stored: what an upload of this catalog would do
  app.post('/apps/:slug/catalog/check', { schema: { params: slugParams, body: catalogBody } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, PRODUCT_EDITORS);
    return checkCatalog(found.id, request.body.catalog);
  });

  app.post(
    '/apps/:slug/catalog',
    { schema: { params: slugParams, body: catalogBody } },
    async (request, reply) => {
      const session = adminOf(request);
      const found = await findAppForAdmin(session, request.params.slug, PRODUCT_EDITORS);
      const result = await uploadCatalog(actorOf(request), session.email, found, request.body.catalog);
      return reply.code(result.status === 'created' ? 201 : 200).send(result);
    },
  );
}