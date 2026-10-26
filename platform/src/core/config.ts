import { z } from 'zod';

// One private Ed25519 key in JWK format.
// looseObject keeps extra fields such as "alg" and "use".
const signingKeySchema = z.looseObject({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  x: z.string(), // public part
  d: z.string(), // private part
  kid: z.string().min(1),
});

// Schema of every environment variable the server reads.
// Validated once at startup; the rest of the code imports `config`.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  // Connection string, e.g. postgres://user:password@host:5432/db
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

  // Value of the "iss" claim in access tokens
  JWT_ISSUER: z.string().min(1).default('apps-platform'),
  // Base64url-encoded JSON array of private keys; the first one signs.
  // Generate with: pnpm keys:generate
  JWT_SIGNING_KEYS: z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
      } catch {
        ctx.issues.push({
          code: 'custom',
          message: 'must be base64url-encoded JSON',
          input: value,
        });
        return z.NEVER;
      }
    })
    .pipe(z.array(signingKeySchema).min(1)),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(90),
  // A rotated refresh token may be retried within this window
  // (e.g. after a lost response) without revoking the family
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).default(30),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // A misconfigured server must not start: list every problem and exit
    console.error('Invalid environment configuration:');
    console.error(z.prettifyError(result.error));
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();