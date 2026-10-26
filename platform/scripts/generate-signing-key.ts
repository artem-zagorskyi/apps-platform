import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair } from 'jose';

// Generates a new Ed25519 key for signing access tokens and prints
// a ready-to-paste JWT_SIGNING_KEYS line for .env.
// Never commit the output and never reuse a dev key in production.

const { privateKey } = await generateKeyPair('EdDSA', { extractable: true });
const jwk = await exportJWK(privateKey);

const key = {
  ...jwk,
  // Key id: creation date plus a random suffix, e.g. 2026-10-26-3f9a1c2b
  kid: `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`,
  alg: 'EdDSA',
  use: 'sig',
};

// Base64url avoids quoting problems with JSON inside .env and Docker
const encoded = Buffer.from(JSON.stringify([key])).toString('base64url');
console.log(`JWT_SIGNING_KEYS=${encoded}`);