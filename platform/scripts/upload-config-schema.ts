import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/core/db.js';
import { AppError } from '../src/core/errors.js';
import { apps } from '../src/modules/apps/schema.js';
import { uploadParameterSchema } from '../src/modules/config/schemas-service.js';

// Uploads an app's parameter declarations (the JSON written by the SDK
// generator from remote_config.yaml).
// Usage: pnpm config:schema <app slug> <path to remote_config.json>
// Temporary until the admin panel and CI can do it.

const [slug, path] = process.argv.slice(2);

if (!slug || !path) {
  console.error('Usage: pnpm config:schema <app slug> <path to remote_config.json>');
  process.exitCode = 1;
} else {
  const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, slug));

  if (!app) {
    console.error(`Unknown app "${slug}"`);
    process.exitCode = 1;
  } else {
    try {
      const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
      const result = await uploadParameterSchema(app.id, json);
      console.log(
        result.status === 'created'
          ? `Uploaded a new parameter schema with ${result.parameters} parameters`
          : 'The parameter schema is already up to date',
      );
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      console.error(err.message);
      process.exitCode = 1;
    }
  }
}

await pool.end();