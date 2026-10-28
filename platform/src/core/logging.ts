import type { FastifyRequest } from 'fastify';

// How a request appears in log lines. The client IP is personal data and
// is never stored, server logs included: it is used in memory only
// (rate limits, country lookup) and dropped.
export function serializeRequest(request: FastifyRequest) {
  return {
    method: request.method,
    url: request.url,
  };
}