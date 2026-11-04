// Values that are not account ids but a bug in the caller: an unset variable
// turned into text, a placeholder, a literal left in a template. Signing in
// with one of them would put everyone hit by the bug into one account.
// After PostHog's list of illegal distinct ids.
// Keep in sync with packages/platform-client/src/index.ts.
const PLACEHOLDERS = new Set([
  'anonymous',
  'guest',
  'distinctid',
  'distinct_id',
  'id',
  'not_authenticated',
  'email',
  'undefined',
  'null',
  'none',
  'nan',
  'true',
  'false',
  '0',
  '[object object]',
]);

// Why a subject cannot be an account id, or null if it can
export function subjectProblem(subject: string): 'blank' | 'placeholder' | null {
  // Serialized twice by a careless caller: "\"undefined\""
  const bare = subject.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  if (bare.length === 0) return 'blank';
  return PLACEHOLDERS.has(bare.toLowerCase()) ? 'placeholder' : null;
}