import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config.js';

// Secrets stored in the database (webhook secrets, later Apple tokens) are
// encrypted with AES-256-GCM. A database dump alone does not reveal them.
// Format: v1.<iv>.<auth tag>.<ciphertext>, parts in base64url.

const key = Buffer.from(config.DATA_ENCRYPTION_KEY, 'base64url');

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

// Throws when the value was changed or encrypted with another key
export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined) {
    throw new Error('Unknown secret format');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}