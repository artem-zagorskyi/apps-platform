import { prepareTestEnv } from './env.js';

// Must run before any module from src/ is imported:
// src/core/config.ts reads process.env once at import time
await prepareTestEnv();

// Most tests run without a job queue: jobs they send are recorded instead
const { setFallbackJobSender } = await import('../src/core/jobs.js');
const { queuedJobs } = await import('./jobs.js');
setFallbackJobSender(async (name, data) => {
  queuedJobs.push({ name, data });
});