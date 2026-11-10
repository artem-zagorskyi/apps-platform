// Downloads the free DB-IP City Lite database (CC BY 4.0) to GEOIP_DB_PATH.
// DB-IP publishes it monthly; run this once a month and restart the server.
// The admin panel credits DB-IP wherever locations are shown, as the licence asks.
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { createGunzip } from 'node:zlib';
import { config } from '../src/core/config.js';

const path = config.GEOIP_DB_PATH;
if (!path) {
  console.error('Set GEOIP_DB_PATH first, e.g. GEOIP_DB_PATH=./data/dbip-city-lite.mmdb');
  process.exit(1);
}

// Early in a month the new file may not be out yet: then last month's
function months(now = new Date()): string[] {
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [now.toISOString().slice(0, 7), previous.toISOString().slice(0, 7)];
}

for (const month of months()) {
  const url = `https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`;
  const response = await fetch(url);
  if (response.status === 404) continue;
  if (!response.ok || !response.body) {
    console.error(`Download failed: HTTP ${response.status} for ${url}`);
    process.exit(1);
  }

  await mkdir(dirname(path), { recursive: true });
  // Written next to the target and renamed: a half-written file never replaces a good one
  const partial = `${path}.download`;
  await pipeline(
    Readable.fromWeb(response.body as unknown as NodeReadableStream),
    createGunzip(),
    createWriteStream(partial),
  );
  await rename(partial, path);

  const { size } = await stat(path);
  console.log(`DB-IP City Lite ${month} saved to ${path} (${Math.round(size / 1e6)} MB). Restart the server to use it.`);
  process.exit(0);
}

console.error('No DB-IP City Lite file for this month or the last one');
process.exit(1);
