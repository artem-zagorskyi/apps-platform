import { createServer, type ServerOptions } from './core/http.js';
import { isDatabaseReachable } from './core/db.js';
import { identityRoutes } from './modules/identity/routes.js';
import { consentRoutes } from './modules/identity/consent-routes.js';
import { eventsRoutes } from './modules/events/routes.js';
import { getPlatformPlan } from './modules/events/plans-service.js';
import { configRoutes } from './modules/config/routes.js';
import { billingRoutes } from './modules/billing/routes.js';

export type BuildAppOptions = Pick<ServerOptions, 'logStream'>;

// Builds the public Fastify instance with all plugins and routes.
// Kept separate from server.ts so tests can build an app
// and send requests to it without opening a real port.
export async function buildApp(options: BuildAppOptions = {}) {
  const app = await createServer(options);

  // Health check: the process is alive and the database answers.
  // Responds 503 if the database is unreachable.
  app.get('/health', async (_request, reply) => {
    const databaseOk = await isDatabaseReachable();

    if (!databaseOk) {
      return reply.code(503).send({ status: 'degraded', database: 'unreachable' });
    }

    return { status: 'ok', database: 'ok' };
  });

  // Filled by requireAuth on protected routes
  app.decorateRequest('auth', null);

  // A broken platform tracking plan must stop the server at start-up
  getPlatformPlan();

  // Feature modules
  await app.register(identityRoutes);
  await app.register(consentRoutes);
  await app.register(eventsRoutes);
  await app.register(configRoutes);
  await app.register(billingRoutes);

  return app;
}