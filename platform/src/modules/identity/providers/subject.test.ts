import { describe, expect, it } from 'vitest';
import { subjectProblem } from './subject.js';

describe('subjectProblem', () => {
  it.each(['acc_123', 'user@example.com', '42', '018f3a2c-7b1e-7c3d-9a8b-1c2d3e4f5a6b', 'identity-7'])(
    'accepts %s',
    (subject) => {
      expect(subjectProblem(subject)).toBeNull();
    },
  );

  it.each([
    'undefined',
    'UNDEFINED',
    'null',
    'None',
    'NaN',
    '0',
    '[object Object]',
    'anonymous',
    'Guest',
    'id',
    'email',
    'true',
    'false',
    'not_authenticated',
    'distinct_id',
  ])('refuses the placeholder %s', (subject) => {
    expect(subjectProblem(subject)).toBe('placeholder');
  });

  it.each(['"undefined"', "'null'", ' undefined ', '"0"', '" anonymous "'])(
    'refuses a quoted or padded placeholder %s',
    (subject) => {
      expect(subjectProblem(subject)).toBe('placeholder');
    },
  );

  it.each(['', '   ', '""', "''"])('refuses the blank subject %j', (subject) => {
    expect(subjectProblem(subject)).toBe('blank');
  });
});