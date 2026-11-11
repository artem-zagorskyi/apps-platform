import { describe, expect, it } from 'vitest';
import { explainConfig } from './evaluate.js';

const ctx = {
  appId: '019a0000-0000-7000-8000-000000000001',
  userId: '019a0000-0000-7000-8000-000000000002',
  platform: 'android' as const,
  appVersion: '1.4.0',
  country: 'DE',
  linked: false,
  userCreatedAt: new Date('2026-11-01T00:00:00Z'),
};

const active = {
  number: 3,
  document: {
    format_version: 1,
    layers: ['main'],
    holdout: { percent: 100 },
    parameters: { goal: { value: 20, rules: [{ when: { countries: ['DE'] }, value: 25 }] } },
    experiments: {
      test: {
        status: 'running',
        layer: 'main',
        traffic: { from: 0, to: 100 },
        variants: { a: { weight: 50, values: { goal: 30 } }, b: { weight: 50, values: { goal: 40 } } },
        forced: { [ctx.userId]: 'b' },
      },
      old: { status: 'stopped', layer: 'main', traffic: { from: 0, to: 0 }, variants: {} },
    },
  },
} as never;

describe('explain without a user ID', () => {
  it('leaves holdout and experiments out and still applies rules', () => {
    const result = explainConfig(active, ctx, { bucketing: false });
    expect(result.holdout).toEqual({ percent: 100, bucket: null, inHoldout: false });
    expect(result.experiments).toEqual([
      { key: 'old', outcome: 'not_running', status: 'stopped' },
      { key: 'test', outcome: 'needs_user_id' },
    ]);
    expect(result.parameters).toEqual([{ name: 'goal', value: 25, source: { kind: 'rule', index: 0 }, skippedRules: [] }]);
  });

  it('is unchanged by default', () => {
    const result = explainConfig(active, ctx);
    expect(result.experiments.find((e) => e.key === 'test')).toMatchObject({ outcome: 'forced', variant: 'b' });
    expect(result.holdout.inHoldout).toBe(true);
  });
});
