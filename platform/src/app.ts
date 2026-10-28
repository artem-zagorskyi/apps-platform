import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { config } from './core/config.js';
import { isDatabaseReachable } from './core/db.js';
import { AppError } from './core/errors.js';
import { serializeRequest } from './core/logging.js';
import { identityRoutes } from './modules/identity/routes.js';

export interface BuildAppOptions {
  // Tests only: receive log lines at info level instead of the configured output
  logStream?: { write(line: string): void };
}

// Builds the Fastify instance with all plugins and routes.
// Kept separate from server.ts so tests can build an app
// and send requests to it without opening a real port.
export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: {
      level: options.logStream ? 'info' : config.LOG_LEVEL,
      serializers: { req: serializeRequest },
      ...(options.logStream
        ? { stream: options.logStream }
        : // Human-readable logs in development, raw JSON everywhere else
          config.NODE_ENV === 'development' && {
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
      if (error.internalReason) {
        request.log.warn({ code: error.code, reason: error.internalReason }, 'request rejected');
      }
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

  // Feature modules
  await app.register(identityRoutes);

  return app;
}