import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requireAuth } from '../identity/auth.js';
import { getEntitlements } from './entitlements.js';
import { purchaseStateEnum, storeEnum } from './schema.js';

const entitlementsResponse = z.object({
  entitlements: z.array(
    z.object({
      key: z.string(),
      productId: z.string(),
      store: z.enum(storeEnum.enumValues),
      state: z.enum(purchaseStateEnum.enumValues),
      expiresAt: z.iso.datetime().nullable(),
      willRenew: z.boolean(),
    }),
  ),
});

export const billingRoutes: FastifyPluginAsyncZod = async (app) => {
  // What the current user has access to right now
  app.get(
    '/v1/billing/entitlements',
    {
      preHandler: requireAuth,
      schema: { response: { 200: entitlementsResponse } },
    },
    async (request) => {
      const auth = authOf(request);
      const entitlements = await getEntitlements(auth.appId, auth.userId, new Date());
      return {
        entitlements: entitlements.map((e) => ({ ...e, expiresAt: e.expiresAt?.toISOString() ?? null })),
      };
    },
  );
};