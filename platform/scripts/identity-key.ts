
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/core/db.js';
import { apps } from '../src/modules/apps/schema.js';
import { addIdentityKey, revokeIdentityKey } from '../src/modules/apps/service.js';
import { generateIdentityKey } from '../src/modules/apps/identity-keys.js';

// Creates a signing key for an app backend's identity assertions: registers
// the public half and prints the private half once.
// Usage: pnpm identity:key <app slug>
//        pnpm identity:key <app slug> --revoke <kid>
// Temporary until the admin panel can do it.

const [slug, flag, revokeKid] = process.argv.slice(2);

if (!slug || (flag !== undefined && (flag !== '--revoke' || !revokeKid))) {
  console.error('Usage: pnpm identity:key <app slug> [--revoke <kid>]');
  process.exitCode = 1;
} else {
  const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, slug));

  if (!app) {
    console.error(`Unknown app "${slug}"`);
    process.exitCode = 1;
  } else if (revokeKid) {
    const revoked = await revokeIdentityKey(app.id, revokeKid);
    console.log(revoked ? `Key ${revokeKid} revoked` : `No active key ${revokeKid}`);
  } else {
    const { kid, publicJwk, privateKeyEnv } = await generateIdentityKey();

    await addIdentityKey(app.id, kid, publicJwk);
    console.log(`Registered key ${kid} for ${slug}`);
    console.log('Private key for the app backend .env (shown once, never commit it):');
    console.log(`PLATFORM_IDENTITY_KEY=${privateKeyEnv}`);
  }
}

await pool.end();