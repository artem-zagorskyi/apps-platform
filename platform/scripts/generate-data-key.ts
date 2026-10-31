import { randomBytes } from 'node:crypto';

// Prints a new DATA_ENCRYPTION_KEY line for .env.
// Changing the key makes stored secrets unreadable: set them again afterwards.
console.log(`DATA_ENCRYPTION_KEY=${randomBytes(32).toString('base64url')}`);