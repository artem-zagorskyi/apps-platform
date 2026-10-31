import { eq } from 'drizzle-orm';
import { db, pool } from '../src/core/db.js';
import { AppError } from '../src/core/errors.js';
import { apps } from '../src/modules/apps/schema.js';
import { removeEndpoint, setEndpoint } from '../src/modules/webhooks/service.js';

// Sets where an app's backend receives notifications and prints a new
// signing secret, or removes the endpoint.
// Usage: pnpm webhooks:set <app slug> <url>
//        pnpm webhooks:set <app slug> off
// Temporary until the admin panel can do it.

const [slug, url] = process.argv.slice(2);

if (!slug || !url) {
  console.error('Usage: pnpm webhooks:set <app slug> <url | off>');
  process.exitCode = 1;
} else {
  const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, slug));

  if (!app) {
    console.error(`Unknown app "${slug}"`);
    process.exitCode = 1;
  } else if (url === 'off') {
    await removeEndpoint(app.id);
    console.log('Webhook endpoint removed');
  } else {
    try {
      const secret = await setEndpoint(app.id, url);
      console.log(`Webhook endpoint set: ${url}`);
      console.log(`Signing secret (shown once, give it to the app backend): ${secret}`);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      console.error(err.message);
      process.exitCode = 1;
    }
  }
}

await pool.end();