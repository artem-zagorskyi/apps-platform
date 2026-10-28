import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { pool } from './core/db.js';

let server: FastifyInstance;

beforeEach(async () => {
  server = await buildApp();
});

afterEach(async () => {
  await server.close();
});

afterAll(async () => {
  await pool.end();
});

describe('GET /health', () => {
  it('reports the server and the database as ok', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', database: 'ok' });
  });
  it('does not write the client IP to the logs', async () => {
    const lines: string[] = [];
    const logged = await buildApp({ logStream: { write: (line) => void lines.push(line) } });

    await logged.inject({ method: 'GET', url: '/health', remoteAddress: '203.0.113.7' });
    await logged.close();

    const output = lines.join('');
    expect(output).toContain('/health'); // the request was logged
    expect(output).not.toContain('203.0.113.7');
  });
});