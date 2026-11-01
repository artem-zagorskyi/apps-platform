import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/core/db.js';
import { AppError } from '../src/core/errors.js';
import { apps } from '../src/modules/apps/schema.js';
import { uploadCatalog } from '../src/modules/billing/catalog.js';

// Replaces an app's product catalog (products and the entitlements they grant).
// Usage: pnpm billing:catalog <app slug> <path to catalog.json>
// Temporary until the admin panel can do it.

const [slug, path] = process.argv.slice(2);

if (!slug || !path) {
  console.error('Usage: pnpm billing:catalog <app slug> <path to catalog.json>');
  process.exitCode = 1;
} else {
  const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, slug));

  if (!app) {
    console.error(`Unknown app "${slug}"`);
    process.exitCode = 1;
  } else {
    try {
      const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
      const r = await uploadCatalog(app.id, json);
      console.log(`Catalog: ${r.added} added, ${r.updated} updated, ${r.archived} archived, ${r.unchanged} unchanged`);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      console.error(err.message);
      process.exitCode = 1;
    }
  }
}

await pool.end();