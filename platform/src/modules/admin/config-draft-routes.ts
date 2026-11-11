import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { platformEnum } from '../apps/schema.js';
import {
  compareConfigVersions,
  getConfigOverview,
  listConfigVersions,
  rebaseDraft,
  saveDraft,
} from '../config/drafts-service.js';
import { explainForSandbox } from '../config/sandbox.js';
import { getConfigVersion } from '../config/versions-service.js';
import { AppError } from '../../core/errors.js';
import { findAppForAdmin } from './apps-service.js';
import { discardConfigDraft, publishDraft, restoreConfigVersion } from './config-draft-service.js';
import { actorOf, adminOf, requireAdmin } from './guard.js';
import { ALL_ROLES, PRODUCT_EDITORS } from './roles.js';

const slugParams = z.object({ slug: z.string().min(1).max(64) });
const versionParams = slugParams.extend({ version: z.coerce.number().int().min(1) });

const draftBody = z.object({
  // The document is checked by the config module, which reports every problem at once
  document: z.unknown(),
  // The live version the editor saw; null before the first publish
  baseVersion: z.number().int().min(1).nullable(),
  // The draft the editor saw (its updatedAt), so edits of two admins never overwrite each other silently
  expectedUpdatedAt: z.iso.datetime().nullable().optional(),
});

const sandboxBody = z.object({
  config: z.enum(['live', 'draft']),
  user: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('id'), userId: z.uuid(), installationId: z.uuid().optional() }),
    z.object({
      kind: z.literal('manual'),
      platform: z.enum(platformEnum.enumValues),
      appVersion: z.string().regex(/^\d+(\.\d+){0,2}$/, 'must look like 1.2.3'),
      country: z.string().regex(/^[A-Z]{2}$/, 'must be an ISO country code like DE').nullable(),
      linked: z.boolean(),
    }),
  ]),
});

export async function adminConfigDraftRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // Every route here needs a signed-in admin
  app.addHook('preHandler', requireAdmin);

  // Live version, draft with its checks, declared parameters, condition fields
  app.get('/apps/:slug/config', { schema: { params: slugParams } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, ALL_ROLES);
    return getConfigOverview(found.id);
  });

  app.put('/apps/:slug/config/draft', { schema: { params: slugParams, body: draftBody } }, async (request) => {
    const session = adminOf(request);
    const found = await findAppForAdmin(session, request.params.slug, PRODUCT_EDITORS);
    await saveDraft(found.id, request.body.document, {
      baseVersion: request.body.baseVersion,
      expectedUpdatedAt: request.body.expectedUpdatedAt ?? null,
      updatedBy: session.email,
    });
    return getConfigOverview(found.id);
  });

  app.delete('/apps/:slug/config/draft', { schema: { params: slugParams } }, async (request, reply) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, PRODUCT_EDITORS);
    await discardConfigDraft(actorOf(request), found);
    return reply.code(204).send();
  });

  // Carries the draft over to a version published after it was started
  app.post('/apps/:slug/config/draft/rebase', { schema: { params: slugParams } }, async (request) => {
    const session = adminOf(request);
    const found = await findAppForAdmin(session, request.params.slug, PRODUCT_EDITORS);
    const { conflicts } = await rebaseDraft(found.id, session.email);
    return { conflicts, ...(await getConfigOverview(found.id)) };
  });

  app.post(
    '/apps/:slug/config/publish',
    { schema: { params: slugParams, body: z.object({ comment: z.string().trim().min(1).max(500) }) } },
    async (request) => {
      const session = adminOf(request);
      const found = await findAppForAdmin(session, request.params.slug, PRODUCT_EDITORS);
      return publishDraft(actorOf(request), session.email, found, request.body.comment);
    },
  );

  app.get('/apps/:slug/config/versions', { schema: { params: slugParams } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, ALL_ROLES);
    return { versions: await listConfigVersions(found.id) };
  });

  app.get('/apps/:slug/config/versions/:version', { schema: { params: versionParams } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, ALL_ROLES);
    const version = await getConfigVersion(found.id, request.params.version);
    if (!version) throw new AppError(404, 'version_not_found', 'No such version');
    return {
      version: version.number,
      document: version.document,
      comment: version.comment,
      publishedAt: version.createdAt,
    };
  });

  app.get(
    '/apps/:slug/config/compare',
    {
      schema: {
        params: slugParams,
        querystring: z.object({ from: z.coerce.number().int().min(1), to: z.coerce.number().int().min(1) }),
      },
    },
    async (request) => {
      const found = await findAppForAdmin(adminOf(request), request.params.slug, ALL_ROLES);
      return compareConfigVersions(found.id, request.query.from, request.query.to);
    },
  );

  // Which config a user gets and why; changes nothing
  app.post('/apps/:slug/config/sandbox', { schema: { params: slugParams, body: sandboxBody } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, ALL_ROLES);
    return explainForSandbox(found.id, request.body.config, request.body.user);
  });

  // An old version's parameters as the draft; experiments and holdout stay as live
  app.post(
    '/apps/:slug/config/versions/:version/restore',
    { schema: { params: versionParams, body: z.object({ replace: z.boolean().default(false) }) } },
    async (request) => {
      const session = adminOf(request);
      const found = await findAppForAdmin(session, request.params.slug, PRODUCT_EDITORS);
      await restoreConfigVersion(actorOf(request), session.email, found, request.params.version, request.body.replace);
      return getConfigOverview(found.id);
    },
  );
}
