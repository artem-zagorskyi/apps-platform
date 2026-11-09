import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { findAppForAdmin } from './apps-service.js';
import { getConsentSettings, newConsentPolicyVersion, saveConsentPolicy } from './consents-service.js';
import { actorOf, adminOf, requireAdmin } from './guard.js';
import { SETTINGS_EDITORS, SETTINGS_READERS } from './roles.js';

const slugParams = z.object({ slug: z.string().min(1).max(64) });
const policyBody = z.object({
  mode: z.enum(['optional', 'consent_or_pay']),
  repromptAfterDays: z.number().int().min(30).max(730),
});
const reasonBody = z.object({ reason: z.string().trim().min(1).max(500) });

export async function adminConsentRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // Every route here needs a signed-in admin
  app.addHook('preHandler', requireAdmin);

  app.get('/apps/:slug/consent-policy', { schema: { params: slugParams } }, async (request) => {
    const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_READERS);
    return getConsentSettings(found.id);
  });

  app.put(
    '/apps/:slug/consent-policy',
    { schema: { params: slugParams, body: policyBody } },
    async (request) => {
      const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_EDITORS);
      return { policy: await saveConsentPolicy(actorOf(request), found, request.body) };
    },
  );

  app.post(
    '/apps/:slug/consent-policy/new-version',
    { schema: { params: slugParams, body: reasonBody } },
    async (request) => {
      const found = await findAppForAdmin(adminOf(request), request.params.slug, SETTINGS_EDITORS);
      return { policy: await newConsentPolicyVersion(actorOf(request), found, request.body.reason) };
    },
  );
}