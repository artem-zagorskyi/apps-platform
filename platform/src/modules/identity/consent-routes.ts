import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { consentModeEnum } from '../apps/schema.js';
import { authOf, requireAuth } from './auth.js';
import { getConsentState, recordConsent } from './consent.js';
import { consentPurposeEnum } from './schema.js';

const consentStateResponse = z.object({
  policy: z.object({
    region: z.string(),
    mode: z.enum(consentModeEnum.enumValues),
    version: z.string(),
  }),
  status: z.enum(['needs_decision', 'decided', 'not_required']),
  decisions: z.array(
    z.object({
      purpose: z.enum(consentPurposeEnum.enumValues),
      granted: z.boolean(),
      policyVersion: z.string(),
      decidedAt: z.iso.datetime(),
    }),
  ),
  canAskAgainAt: z.iso.datetime().nullable(),
});

const recordConsentBody = z.object({
  decisions: z
    .object({
      analytics: z.boolean().optional(),
      personalization: z.boolean().optional(),
    })
    .refine((d) => Object.values(d).some((value) => value !== undefined), {
      message: 'At least one decision is required',
    }),
  policyVersion: z.string().min(1).max(64),
  source: z.enum(['first_launch', 'reprompt', 'settings']),
  decidedAt: z.iso.datetime(),
  sentAt: z.iso.datetime(),
});

export const consentRoutes: FastifyPluginAsyncZod = async (app) => {
  // Current policy, the user's decisions and whether to show the consent screen
  app.get(
    '/v1/consent',
    {
      preHandler: requireAuth,
      schema: { response: { 200: consentStateResponse } },
    },
    async (request) => getConsentState(authOf(request), request.log),
  );

  // Record decisions made on the consent screen or in settings
  app.post(
    '/v1/consent',
    {
      preHandler: requireAuth,
      schema: {
        body: recordConsentBody,
        response: { 200: consentStateResponse },
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request) =>
      recordConsent(
        authOf(request),
        {
          decisions: request.body.decisions,
          policyVersion: request.body.policyVersion,
          source: request.body.source,
          decidedAt: new Date(request.body.decidedAt),
          sentAt: new Date(request.body.sentAt),
        },
        request.log,
      ),
  );
};