// Expected error with an HTTP status and a stable machine-readable code.
// Clients branch on `code`; `message` is for humans and logs.
// Anything else thrown is treated as an internal error.
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// True for a Postgres unique violation (SQLSTATE 23505) on the given constraint.
// Drizzle may wrap the driver error, so the cause is checked as well.
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const candidates = [err, (err as { cause?: unknown } | null)?.cause];

  return candidates.some((candidate) => {
    const pgError = candidate as { code?: string; constraint?: string } | null;
    return pgError?.code === '23505' && pgError.constraint === constraint;
  });
}