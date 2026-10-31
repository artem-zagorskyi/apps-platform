import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { pool } from './db.js';
import { sendJob, startJobs, stopJobs } from './jobs.js';

const received: unknown[] = [];
let failuresLeft = 1;
let server: FastifyInstance;

async function until(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (!condition() && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeAll(async () => {
  // Only for its logger
  server = await buildApp();
  await startJobs(
    [
      {
        name: 'test-echo',
        handler: async (data) => {
          received.push(data);
        },
      },
      {
        name: 'test-flaky',
        retryLimit: 2,
        retryDelaySeconds: 1,
        handler: async (data) => {
          if (failuresLeft > 0) {
            failuresLeft--;
            throw new Error('first attempt fails');
          }
          received.push(data);
        },
      },
    ],
    server.log,
  );
}, 30_000);

afterAll(async () => {
  await stopJobs();
  await server.close();
  await pool.end();
});

describe('jobs', () => {
  it('runs a queued job with its data', async () => {
    const marker = randomUUID();

    await sendJob('test-echo', { marker });
    await until(() => received.some((d) => (d as { marker?: string }).marker === marker));

    expect(received).toContainEqual({ marker });
  }, 20_000);

  it('retries a failed job', async () => {
    const marker = randomUUID();

    await sendJob('test-flaky', { marker });
    await until(() => received.some((d) => (d as { marker?: string }).marker === marker));

    expect(failuresLeft).toBe(0);
    expect(received).toContainEqual({ marker });
  }, 20_000);
});