import { buildApp } from './app.js';
import { config } from './core/config.js';
import { pool } from './core/db.js';
import { openGeoIp } from './core/geoip.js';
import { ensureEventPartitions } from './modules/events/partitions.js';

// Month partitions of the events table are created ahead of time.
// Checked twice a day; moves to the job queue once it exists.
const PARTITION_CHECK_MS = 12 * 60 * 60 * 1000;

const app = await buildApp();

if (await openGeoIp(config.GEOIP_DB_PATH)) {
  app.log.info('GeoIP database loaded');
}

await ensureEventPartitions();
const partitionTimer = setInterval(() => {
  ensureEventPartitions().catch((err: unknown) => app.log.error(err, 'partition check failed'));
}, PARTITION_CHECK_MS);
// The timer alone must not keep the process alive
partitionTimer.unref();

// Graceful shutdown: let in-flight requests finish before exiting.
// Docker sends SIGTERM on stop, Ctrl+C sends SIGINT.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    clearInterval(partitionTimer);
    await app.close();
    // The app does not own the database pool, so it is closed here
    await pool.end();
    process.exit(0);
  });
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.error(err, 'failed to start');
  process.exit(1);
}