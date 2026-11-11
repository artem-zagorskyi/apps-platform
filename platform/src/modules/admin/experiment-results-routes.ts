import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../core/errors.js';
import { experimentResults, experimentsSummary, loadExperiment } from '../reports/experiments.js';
import { findAppForAdmin } from './apps-service.js';
import { adminOf, requireAdmin } from './guard.js';
import { ALL_ROLES } from './roles.js';

const slugParams = z.object({ slug: z.string().min(1).max(64) });

export async function adminExperimentResultsRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // Every route here needs a signed-in admin
  app.addHook('preHandler', requireAdmin);

  // Exposed users, health and the leader of every started experiment
  app.get('/apps/:slug/config/experiments/summary', { schema: { params: slugParams } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, ALL_ROLES);
    try {
      return { experiments: await experimentsSummary(found.id) };
    } catch (err) {
      // Nothing published yet: nothing has started
      if (err instanceof AppError && err.code === 'not_found') return { experiments: [] };
      throw err;
    }
  });

  app.get(
    '/apps/:slug/config/experiments/:key/results',
    {
      schema: {
        params: slugParams.extend({ key: z.string().min(1).max(64) }),
        querystring: z.object({ control: z.string().min(1).max(64).optional() }),
      },
    },
    async (request) => {
      const found = await findAppForAdmin(adminOf(request), request.params.slug, ALL_ROLES);
      const experiment = await loadExperiment(found.id, request.params.key);
      return experimentResults(found.id, request.params.key, experiment, {
        ...(request.query.control ? { control: request.query.control } : {}),
      });
    },
  );
}
