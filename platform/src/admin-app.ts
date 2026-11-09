import { createServer, type ServerOptions } from './core/http.js';
import { adminAppsRoutes } from './modules/admin/apps-routes.js';
import { adminAuthRoutes } from './modules/admin/routes.js';
import { adminConsentRoutes } from './modules/admin/consents-routes.js';
import { adminWebhookRoutes } from './modules/admin/webhooks-routes.js';
import { adminTrackingPlanRoutes } from './modules/admin/tracking-plan-routes.js';

// The internal admin API: a second Fastify server in the same process,
// listening on ADMIN_PORT. Only the admin panel's Next.js server calls it;
// none of these routes exist on the public server.
export async function buildAdminApp(options: Pick<ServerOptions, 'logStream'> = {}) {
  const app = await createServer({ ...options, name: 'admin' });

  // Filled by requireAdmin on protected routes
  app.decorateRequest('admin', null);

  await app.register(adminAuthRoutes, { prefix: '/admin/v1' });
  await app.register(adminAppsRoutes, { prefix: '/admin/v1' });
  await app.register(adminConsentRoutes, { prefix: '/admin/v1' });
  await app.register(adminWebhookRoutes, { prefix: '/admin/v1' });
  await app.register(adminTrackingPlanRoutes, { prefix: '/admin/v1' });

  return app;
}