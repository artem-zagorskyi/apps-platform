import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { config } from './config.js';
import { AppError } from './errors.js';
import { serializeRequest } from './logging.js';

export interface ServerOptions {
  // Tests only: receive log lines at info level instead of the configured output
  logStream?: { write(line: string): void };
  // Added to every log line, tells the public and the admin server apart
  name?: string;
}

// A Fastify instance with what the public and the admin server share:
// logging, zod schemas, opt-in rate limits and one error format
export async function createServer(options: ServerOptions = {}) {
  const app = Fastify({
    logger: {
      name: options.name,
      level: options.logStream ? 'info' : config.LOG_LEVEL,
      serializers: { req: serializeRequest },
      ...(options.logStream
        ? { stream: options.logStream }
        : // Human-readable logs in development, raw JSON everywhere else
          config.NODE_ENV === 'development' && {
            transport: { target: 'pino-pretty' },
          }),
    },
    // Trust only the last TRUST_PROXY_HOPS proxies (hop 0 is the socket peer):
    // the same as a hop count, in the form the typings accept
    trustProxy: (_address, hop) => hop < config.TRUST_PROXY_HOPS,
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

  return app;
}