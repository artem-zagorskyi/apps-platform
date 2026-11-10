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
  addOAuthClient,
  createBackendKey,
  getSignInSettings,
  removeOAuthClient,
  revokeBackendKey
} from './apps-service.js';
import { actorOf, adminOf, requireAdmin } from './guard.js';
import { SETTINGS_EDITORS, SETTINGS_READERS, hasGlobalRole } from './roles.js';
import { getSettingsStatus } from './settings-status.js';

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

  // State of every settings tab, for the dots and the setup checklist
  app.get('/apps/:slug/settings-status', { schema: { params: slugParams } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_READERS);
    return { tabs: await getSettingsStatus(found) };
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

    app.get('/apps/:slug/sign-in', { schema: { params: slugParams } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_READERS);
    return getSignInSettings(found.id);
  });

  app.post(
    '/apps/:slug/oauth-clients',
    {
      schema: {
        params: slugParams,
        body: z.object({
          provider: z.enum(['google', 'apple']),
          platform: z.enum(platformEnum.enumValues),
          clientId: z.string().trim().min(1).max(255),
        }),
      },
    },
    async (request, reply) => {
      const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_EDITORS);
      const created = await addOAuthClient(actorOf(request), found, request.body);
      return reply.code(201).send({ oauthClient: created });
    },
  );

  app.delete(
    '/apps/:slug/oauth-clients/:clientId',
    { schema: { params: slugParams.extend({ clientId: z.uuid() }) } },
    async (request, reply) => {
      const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_EDITORS);
      await removeOAuthClient(actorOf(request), found, request.params.clientId);
      return reply.code(204).send();
    },
  );

  app.post('/apps/:slug/identity-keys', { schema: { params: slugParams } }, async (request, reply) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_EDITORS);
    const key = await createBackendKey(actorOf(request), found);
    // The private key must not stay in any cache on the way
    return reply.code(201).header('cache-control', 'no-store').send(key);
  });

  app.post(
    '/apps/:slug/identity-keys/:kid/revoke',
    {
      schema: {
        params: slugParams.extend({ kid: z.string().min(1).max(100) }),
        body: z.object({ reason: z.string().trim().min(1).max(500) }),
      },
    },
    async (request, reply) => {
      const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_EDITORS);
      await revokeBackendKey(actorOf(request), found, request.params.kid, request.body.reason);
      return reply.code(204).send();
    },
  );
}