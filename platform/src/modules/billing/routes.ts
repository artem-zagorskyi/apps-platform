import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requireAuth } from '../identity/auth.js';
import { getEntitlements, serializeEntitlements } from './entitlements.js';
import { registerPurchase } from './purchases.js';
import { purchaseStateEnum, storeEnum } from './schema.js';
import { pushBodySchema, receivePlayNotification, verifyPubSubPush } from './google-notifications.js';

const entitlementsSchema = z.array(
  z.object({
    key: z.string(),
    productId: z.string(),
    store: z.enum(storeEnum.enumValues),
    state: z.enum(purchaseStateEnum.enumValues),
    expiresAt: z.iso.datetime().nullable(),
    willRenew: z.boolean(),
  }),
);

const purchaseBody = z.object({
  store: z.enum(storeEnum.enumValues),
  productId: z.string().min(1).max(100),
  // Google purchaseToken, Apple originalTransactionId
  purchaseKey: z.string().min(1).max(2048),
});

const purchaseResponse = z.object({
  status: z.enum(['owned', 'transferred', 'sign_in_required', 'owned_by_other_account']),
  maskedEmail: z.string().nullable(),
  entitlements: entitlementsSchema,
});

export const billingRoutes: FastifyPluginAsyncZod = async (app) => {
  // What the current user has access to right now
  app.get(
    '/v1/billing/entitlements',
    {
      preHandler: requireAuth,
      schema: { response: { 200: z.object({ entitlements: entitlementsSchema }) } },
    },
    async (request) => {
      const auth = authOf(request);
      return { entitlements: serializeEntitlements(await getEntitlements(auth.appId, auth.userId, new Date())) };
    },
  );

  // A purchase made in the app, or one found in the store on restore
  app.post(
    '/v1/purchases',
    {
      preHandler: requireAuth,
      schema: { body: purchaseBody, response: { 200: purchaseResponse } },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request) => {
      const result = await registerPurchase(authOf(request), request.body);
      return { ...result, entitlements: serializeEntitlements(result.entitlements) };
    },
  );

  // Google Play real-time developer notifications, pushed by Pub/Sub.
  // Any answer but 2xx makes Pub/Sub redeliver, so the work happens in a job.
  app.post(
    '/v1/billing/google/notifications',
    { schema: { body: pushBodySchema, response: { 204: z.void() } } },
    async (request, reply) => {
      await verifyPubSubPush(request.headers.authorization);
      await receivePlayNotification(request.body);
      return reply.code(204).send();
    },
  );
};