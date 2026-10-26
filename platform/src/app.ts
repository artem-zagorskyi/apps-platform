import Fastify from 'fastify';
import { config } from './core/config.js';
import { pool, isDatabaseReachable } from './core/db.js';

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

  // Release database connections when the server shuts down
  app.addHook('onClose', async () => {
    await pool.end();
  });

  // Health check: the process is alive and the database answers.
  // Responds 503 if the database is unreachable.
  app.get('/health', async (_request, reply) => {
    const databaseOk = await isDatabaseReachable();

    if (!databaseOk) {
      return reply.code(503).send({ status: 'degraded', database: 'unreachable' });
    }

    return { status: 'ok', database: 'ok' };
  });

  return app;
}