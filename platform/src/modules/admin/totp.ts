import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// TOTP per RFC 6238 with the parameters every authenticator app supports:
// HMAC-SHA1, 6 digits, 30-second steps.
const STEP_SECONDS = 30;
const DIGITS = 6;
// Also accept the previous and the next step: phone clocks drift a little
const WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// 160 random bits, the size RFC 4226 recommends for HMAC-SHA1.
// Stored encrypted (core/crypto) as base64url.
export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

// Authenticator apps expect the secret in base32 (RFC 4648, no padding)
function toBase32(bytes: Buffer): string {
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

// Content of the QR code scanned by Google Authenticator
export function totpUri(secret: Buffer, email: string, issuer = 'Apps Platform Admin'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret: toBase32(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params}`;
}

// HOTP (RFC 4226): HMAC of the counter, dynamic truncation, last N digits
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

// Returns the matched time step, or null when the code is wrong.
// Steps up to and including lastStep are skipped: the caller stores the
// returned step, so a code seen over someone's shoulder cannot be reused.
export function verifyTotp(
  secret: Buffer,
  code: string,
  lastStep: number | null,
  now: number = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) {
    return null;
  }
  const current = Math.floor(now / 1000 / STEP_SECONDS);
  for (let step = current - WINDOW; step <= current + WINDOW; step++) {
    if (lastStep !== null && step <= lastStep) {
      continue;
    }
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code))) {
      return step;
    }
  }
  return null;
}