import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requireAuth } from '../identity/auth.js';
import { ingestEvents } from './ingest.js';

const incomingEvent = z.object({
  eventId: z.uuid(),
  name: z.string().min(1).max(64),
  occurredAt: z.iso.datetime(),
  sessionId: z.uuid().nullable(),
  seq: z.number().int().min(0),
  appVersion: z.string().min(1).max(32),
  appBuild: z.string().min(1).max(32),
  osVersion: z.string().min(1).max(64),
  properties: z
    .record(z.string().max(64), z.unknown())
    .refine((p) => Object.keys(p).length <= 50, { message: 'At most 50 properties' }),
});

const batchBody = z.object({
  sentAt: z.iso.datetime(),
  events: z.array(incomingEvent).min(1).max(100),
});

const batchResponse = z.object({
  accepted: z.array(z.uuid()),
  rejected: z.array(z.object({ eventId: z.uuid(), reason: z.string() })),
});

export const eventsRoutes: FastifyPluginAsyncZod = async (app) => {
  // A batch of events from the SDK queue
  app.post(
    '/v1/events',
    {
      preHandler: requireAuth,
      schema: {
        body: batchBody,
        response: { 200: batchResponse },
      },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request) => {
      const result = await ingestEvents(
        authOf(request),
        {
          sentAt: new Date(request.body.sentAt),
          events: request.body.events.map((event) => ({
            ...event,
            occurredAt: new Date(event.occurredAt),
          })),
        },
        request.ip,
      );

      // Invalid events are stored, but someone should look at the tracking plan
      if (result.invalid > 0) {
        request.log.warn({ invalid: result.invalid }, 'events did not match the tracking plan');
      }

      return { accepted: result.accepted, rejected: result.rejected };
    },
  );
};