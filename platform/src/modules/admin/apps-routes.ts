import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../core/errors.js';
import { platformEnum } from '../apps/schema.js';
import {
  createApp,
  findAppForAdmin,
  getAppPlatforms,
  listVisibleApps,
  setPlatform,
  updateApp,
} from './apps-service.js';
import { actorOf, adminOf, requireAdmin } from './guard.js';
import { SETTINGS_EDITORS, SETTINGS_READERS, hasGlobalRole } from './roles.js';

const slugParams = z.object({ slug: z.string().min(1).max(64) });
const platformParams = slugParams.extend({ platform: z.enum(platformEnum.enumValues) });
const name = z.string().trim().min(1).max(80);

export async function adminAppsRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // Every route here needs a signed-in admin
  app.addHook('preHandler', requireAdmin);

  // Apps for the switcher in the panel
  app.get('/apps', async (request) => ({
    apps: await listVisibleApps(adminOf(request)),
  }));

  app.post(
    '/apps',
    { schema: { body: z.object({ slug: z.string().trim().max(64), name }) } },
    async (request, reply) => {
      if (!hasGlobalRole(adminOf(request), ['owner'])) {
        throw new AppError(403, 'forbidden', 'Only owners of every app can create apps');
      }
      const created = await createApp(actorOf(request), request.body);
      return reply.code(201).send({ app: created });
    },
  );

  app.get('/apps/:slug', { schema: { params: slugParams } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_READERS);
    return { app: found, platforms: await getAppPlatforms(found.id) };
  });

  app.patch(
    '/apps/:slug',
    {
      schema: {
        params: slugParams,
        body: z
          .object({
            name: name.optional(),
            status: z.enum(['active', 'disabled']).optional(),
            reason: z.string().trim().min(1).max(500).optional(),
          })
          .refine((body) => body.name !== undefined || body.status !== undefined, 'Nothing to change'),
      },
    },
    async (request) => {
      const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_EDITORS);
      return { app: await updateApp(actorOf(request), found, request.body) };
    },
  );

  app.put(
    '/apps/:slug/platforms/:platform',
    {
      schema: {
        params: platformParams,
        body: z.object({ bundleId: z.string().trim().min(1).max(155) }),
      },
    },
    async (request) => {
      const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_EDITORS);
      return {
        platform: await setPlatform(actorOf(request), found, request.params.platform, request.body.bundleId),
      };
    },
  );
}