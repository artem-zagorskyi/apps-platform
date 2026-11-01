import { readFileSync } from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../../core/config.js';
import { GooglePlayProvider, ServiceAccountTokens, serviceAccountSchema } from './google-play.js';
import { registerStoreProvider } from './providers.js';

// Registers the stores whose credentials are configured. A broken key file
// is a deployment error: fail at start-up, not on the first purchase.
export function enableConfiguredStores(log: FastifyBaseLogger): void {
  const keyFile = config.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE;
  if (keyFile) {
    const account = serviceAccountSchema.parse(JSON.parse(readFileSync(keyFile, 'utf8')));
    registerStoreProvider(new GooglePlayProvider(new ServiceAccountTokens(account)));
    log.info({ serviceAccount: account.client_email }, 'Google Play billing enabled');
  } else {
    log.info('Google Play billing disabled: GOOGLE_PLAY_SERVICE_ACCOUNT_FILE is not set');
  }
}