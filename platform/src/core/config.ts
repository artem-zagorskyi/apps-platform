import { z } from 'zod';

// Schema of every environment variable the server reads.
// Validated once at startup; the rest of the code imports `config`.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
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