import { buildApp } from './app.js';
import { config } from './core/config.js';
import { pool } from './core/db.js';

const app = await buildApp();

// Graceful shutdown: let in-flight requests finish before exiting.
// Docker sends SIGTERM on stop, Ctrl+C sends SIGINT.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
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