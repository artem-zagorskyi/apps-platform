import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/core/db.js';
import { AppError } from '../src/core/errors.js';
import { apps } from '../src/modules/apps/schema.js';
import { publishConfig } from '../src/modules/config/versions-service.js';

// Publishes an app's config document as a new version.
// Usage: pnpm config:publish <app slug> <path to config.json> [comment]
// Temporary until the admin panel can do it.

const [slug, path, ...commentWords] = process.argv.slice(2);
const comment = commentWords.join(' ').trim();

if (!slug || !path) {
  console.error('Usage: pnpm config:publish <app slug> <path to config.json> [comment]');
  process.exitCode = 1;
} else {
  const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, slug));

  if (!app) {
    console.error(`Unknown app "${slug}"`);
    process.exitCode = 1;
  } else {
    try {
      const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
      const result = await publishConfig(app.id, json, comment ? { comment } : {});
      console.log(
        result.status === 'created'
          ? `Published config version ${result.version}`
          : `The config is already up to date (version ${result.version})`,
      );
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      console.error(err.message);
      process.exitCode = 1;
    }
  }
}

await pool.end();