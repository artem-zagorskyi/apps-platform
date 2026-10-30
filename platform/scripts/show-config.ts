import { eq } from 'drizzle-orm';
import { db, pool } from '../src/core/db.js';
import { apps } from '../src/modules/apps/schema.js';
import { configDocumentFormat } from '../src/modules/config/document.js';
import { getConfigVersion } from '../src/modules/config/versions-service.js';

// Prints a config version as JSON: the latest one, or the given number.
// The JSON goes to stdout and the details to stderr, so the output can be
// saved and published again (a rollback).
// Usage: pnpm -s config:show <app slug> [version] > config.json

const [slug, rawNumber] = process.argv.slice(2);
const number = rawNumber === undefined ? undefined : Number.parseInt(rawNumber, 10);

if (!slug || (number !== undefined && !Number.isInteger(number))) {
  console.error('Usage: pnpm -s config:show <app slug> [version]');
  process.exitCode = 1;
} else {
  const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, slug));
  const version = app ? await getConfigVersion(app.id, number) : null;

  if (!app) {
    console.error(`Unknown app "${slug}"`);
    process.exitCode = 1;
  } else if (!version) {
    console.error(number === undefined ? 'No config published yet' : `No version ${number}`);
    process.exitCode = 1;
  } else {
    console.error(
      `Version ${version.number}, ${version.createdAt.toISOString()}` +
        (version.comment ? `: ${version.comment}` : ''),
    );
    // Parsing again restores the usual key order (jsonb sorts keys its own way)
    console.log(JSON.stringify(configDocumentFormat.parse(version.document), null, 2));
  }
}

await pool.end();