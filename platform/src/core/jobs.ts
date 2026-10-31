import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { fromDrizzle, PgBoss } from 'pg-boss';
import { config } from './config.js';
import type { Tx } from './db.js';

// Background jobs on pg-boss: stored in Postgres (schema "pgboss"), so they
// survive restarts, are retried, and can be created in the same transaction
// as the data change that needs them.

export interface JobDefinition {
  // Queue name: module prefix, letters, digits and hyphens
  name: string;
  // Cron expression in UTC; scheduled jobs carry no data
  schedule?: string;
  // Retries with exponential backoff
  retryLimit?: number;
  retryDelaySeconds?: number;
  retryDelayMaxSeconds?: number;
  // How long one run may take before it counts as failed
  expireInSeconds?: number;
  // Job data comes back from JSON in the database: validate it
  handler: (data: unknown, log: FastifyBaseLogger) => Promise<void>;
}

let boss: PgBoss | null = null;

// Starts the queue and the workers in this process. Queue settings apply
// when a queue is created; changing them later needs a migration of the queue.
export async function startJobs(definitions: JobDefinition[], log: FastifyBaseLogger): Promise<void> {
  if (boss) throw new Error('Jobs are already started');

  const instance = new PgBoss({
    connectionString: config.DATABASE_URL,
    openTelemetry: { enabled: false },
  });
  instance.on('error', (err) => log.error(err, 'job queue error'));
  await instance.start();

  for (const job of definitions) {
    if (!(await instance.getQueue(job.name))) {
      const queue = {
        name: job.name,
        // Scheduled maintenance: at most one waiting and one running
        ...(job.schedule ? { policy: 'stately' as const } : {}),
        retryLimit: job.retryLimit ?? 3,
        retryDelay: job.retryDelaySeconds ?? 30,
        retryBackoff: true,
        ...(job.retryDelayMaxSeconds ? { retryDelayMax: job.retryDelayMaxSeconds } : {}),
        expireInSeconds: job.expireInSeconds ?? 15 * 60,
      };
      await instance.createQueue(job.name, queue);
    }

    await instance.work(job.name, async (jobs) => {
      for (const item of jobs) {
        const jobLog = log.child({ job: job.name, jobId: item.id });
        try {
          await job.handler(item.data, jobLog);
        } catch (err) {
          // pg-boss retries or fails the job; the reason goes to the log
          jobLog.error(err, 'job failed');
          throw err;
        }
      }
    });

    if (job.schedule) await instance.schedule(job.name, job.schedule);
  }

  boss = instance;
  log.info({ jobs: definitions.map((d) => d.name) }, 'jobs started');
}

// Waits for running jobs to finish
export async function stopJobs(): Promise<void> {
  const instance = boss;
  boss = null;
  if (instance) await instance.stop({ graceful: true });
}

// Queues a job. With a transaction, the job exists only if the transaction commits.
export async function sendJob(name: string, data: Record<string, unknown>, tx?: Tx): Promise<void> {
  if (!boss) throw new Error('Jobs are not started');
  await boss.send(name, data, tx ? { db: fromDrizzle(tx, sql) } : {});
}