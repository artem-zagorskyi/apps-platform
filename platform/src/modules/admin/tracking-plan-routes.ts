import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { checkTrackingPlan, getTrackingPlanOverview } from '../events/plans-service.js';
import { findAppForAdmin } from './apps-service.js';
import { actorOf, adminOf, requireAdmin } from './guard.js';
import { PRODUCT_EDITORS, SETTINGS_READERS } from './roles.js';
import { uploadTrackingPlan } from './tracking-plan-service.js';

const slugParams = z.object({ slug: z.string().min(1).max(64) });
// The plan is checked by the events module, which reports every problem at once
const planBody = z.object({ plan: z.unknown() });

export async function adminTrackingPlanRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // Every route here needs a signed-in admin
  app.addHook('preHandler', requireAdmin);

  app.get('/apps/:slug/tracking-plan', { schema: { params: slugParams } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_READERS);
    return getTrackingPlanOverview(found.id);
  });

  // Nothing is stored: what an upload of this plan would do
  app.post('/apps/:slug/tracking-plan/check', { schema: { params: slugParams, body: planBody } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, PRODUCT_EDITORS);
    return checkTrackingPlan(found.id, request.body.plan);
  });

  app.post(
    '/apps/:slug/tracking-plan',
    { schema: { params: slugParams, body: planBody } },
    async (request, reply) => {
      const session = adminOf(request);
      const found = await findAppForAdmin(session, request.params.slug, PRODUCT_EDITORS);
      const result = await uploadTrackingPlan(actorOf(request), session.email, found, request.body.plan);
      return reply.code(result.status === 'created' ? 201 : 200).send(result);
    },
  );
}