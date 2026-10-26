import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { config } from './core/config.js';
import { isDatabaseReachable, pool } from './core/db.js';
import { AppError } from './core/errors.js';
import { identityRoutes } from './modules/identity/routes.js';

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

  // Route schemas are written in zod
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Rate limits are opt-in per route via `config.rateLimit`
  await app.register(rateLimit, { global: false });

  // One response format for every error: { error, message }
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }

    // Request body or params did not match the route schema
    if (error.validation) {
      return reply.code(400).send({ error: 'validation_failed', message: error.message });
    }

    // Other client errors raised by Fastify or plugins (e.g. 429 from rate limit)
    if (error.statusCode && error.statusCode < 500) {
      return reply
        .code(error.statusCode)
        .send({ error: error.code ?? 'request_error', message: error.message });
    }

    // Unexpected: log the details, never send them to the client
    request.log.error(error);
    return reply.code(500).send({ error: 'internal_error', message: 'Internal server error' });
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

  // Feature modules
  await app.register(identityRoutes);

  return app;
}