import Fastify from 'fastify';
import { config } from './core/config.js';

// Builds the Fastify instance with all plugins and routes.
// Kept separate from server.ts so tests can build an app
// and send requests to it without opening a real port.
export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Human-readable logs in development, raw JSON everywhere else
      ...(config.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty' },
      }),
    },
  });

  // Liveness check for Docker and monitoring
  app.get('/health', async () => {
    return { status: 'ok' };
  });

  return app;
}