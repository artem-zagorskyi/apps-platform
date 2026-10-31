import { buildApp } from './app.js';
import { config } from './core/config.js';
import { pool } from './core/db.js';
import { openGeoIp } from './core/geoip.js';
import { startJobs, stopJobs } from './core/jobs.js';
import { eventsJobs } from './modules/events/jobs.js';
import { ensureEventPartitions } from './modules/events/partitions.js';
import { identityJobs } from './modules/identity/jobs.js';

const app = await buildApp();

if (await openGeoIp(config.GEOIP_DB_PATH)) {
  app.log.info('GeoIP database loaded');
}

// The current month must exist before the first event arrives;
// the daily job keeps the next months ready
await ensureEventPartitions();

// Workers run in this process; they can move to their own process later
await startJobs([...identityJobs, ...eventsJobs], app.log);

// Graceful shutdown: let in-flight requests and jobs finish before exiting.
// Docker sends SIGTERM on stop, Ctrl+C sends SIGINT.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    // No new requests, so no new jobs from them
    await app.close();
    await stopJobs();
    // The app does not own the database pool, so it is closed here
    await pool.end();
    process.exit(0);
  });
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.error(err);
  await stopJobs();
  await pool.end();
  process.exit(1);
}