import { describe, expect, it } from 'vitest';
import type { ConfigDocument, Experiment } from './document.js';
import { bucket, type EvaluatedConfig, type EvaluationContext, evaluateConfig } from './evaluate.js';

const appId = '0190a000-0000-7000-8000-00000000a000';
const userIds = Array.from(
  { length: 10_000 },
  (_, i) => `0190a000-0000-7000-8000-${i.toString().padStart(12, '0')}`,
);
const firstUser = userIds[0] as string;

function context(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    appId,
    userId: firstUser,
    platform: 'android',
    appVersion: '1.0.0',
    country: null,
    linked: false,
    userCreatedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  };
}

function experiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    description: 'Paywall test',
    status: 'running',
    layer: 'default',
    traffic: { from: 0, to: 100 },
    variants: {
      control: { weight: 50, values: { paywall_variant: 'classic' } },
      trial: { weight: 50, values: { paywall_variant: 'trial_first' } },
    },
    started_at: '2026-10-30T00:00:00.000Z',
    ...overrides,
  };
}

function active(document: Partial<ConfigDocument>, number = 7): { number: number; document: ConfigDocument } {
  return {
    number,
    document: {
      format_version: 1,
      holdout: { percent: 0 },
      layers: ['default'],
      parameters: {},
      experiments: {},
      ...document,
    },
  };
}

// How many of the 10,000 users match
function count(
  config: ReturnType<typeof active>,
  predicate: (result: EvaluatedConfig) => boolean,
): number {
  return userIds.filter((userId) => predicate(evaluateConfig(config, context({ userId })))).length;
}

const inExperiment = (key: string) => (result: EvaluatedConfig) =>
  result.experiments.some((e) => e.key === key);

describe('bucket', () => {
  it('is stable and within 0..9999', () => {
    expect(bucket('layer:default:user')).toBe(bucket('layer:default:user'));
    for (const userId of userIds.slice(0, 100)) {
      const b = bucket(userId);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(10_000);
    }
  });
});

describe('evaluateConfig', () => {
  it('is empty without a published config', () => {
    expect(evaluateConfig(null, context())).toEqual({ version: 0, values: {}, experiments: [] });
  });

  it('takes force over experiments over rules over the value', () => {
    const config = active({
      parameters: {
        ads_enabled: { force: false, value: true },
        daily_goal_minutes: { value: 15, rules: [{ when: { countries: ['DE'] }, value: 20 }] },
      },
      experiments: {
        paywall_test: experiment({
          variants: {
            control: { weight: 50, values: { paywall_variant: 'classic', ads_enabled: true } },
            trial: { weight: 50, values: { paywall_variant: 'trial_first', ads_enabled: true } },
          },
        }),
      },
    });

    const result = evaluateConfig(config, context({ country: 'DE' }));
    const assigned = result.experiments[0];

    expect(result.version).toBe(7);
    expect(result.values.ads_enabled).toBe(false);
    expect(result.values.daily_goal_minutes).toBe(20);
    expect(result.values.paywall_variant).toBe(assigned?.variant === 'control' ? 'classic' : 'trial_first');
    // ads_enabled is forced for everyone, so reading it is not an exposure
    expect(assigned?.parameters).toEqual(['paywall_variant']);

    expect(evaluateConfig(config, context()).values.daily_goal_minutes).toBe(15);
  });

  it('uses the first matching rule and leaves unset parameters out', () => {
    const config = active({
      parameters: {
        daily_goal_minutes: {
          value: 15,
          rules: [
            { when: { user_ids: [userIds[1] as string] }, value: 60 },
            { when: { platforms: ['android'] }, value: 30 },
          ],
        },
        ads_enabled: { rules: [{ when: { linked: true }, value: false }] },
      },
    });

    expect(evaluateConfig(config, context()).values).toEqual({ daily_goal_minutes: 30 });
    expect(evaluateConfig(config, context({ userId: userIds[1] as string })).values.daily_goal_minutes).toBe(60);
    expect(evaluateConfig(config, context({ platform: 'ios' })).values.daily_goal_minutes).toBe(15);
    expect(evaluateConfig(config, context({ linked: true })).values.ads_enabled).toBe(false);
  });

  it('splits users by weight and keeps each in the same variant', () => {
    const config = active({ experiments: { paywall_test: experiment() } });

    const control = count(config, (r) => r.experiments[0]?.variant === 'control');

    expect(control).toBeGreaterThan(4700);
    expect(control).toBeLessThan(5300);
    expect(count(config, inExperiment('paywall_test'))).toBe(10_000);
    expect(evaluateConfig(config, context())).toEqual(evaluateConfig(config, context()));
  });

  it('takes only the traffic share into an experiment', () => {
    const config = active({ experiments: { paywall_test: experiment({ traffic: { from: 0, to: 30 } }) } });

    const share = count(config, inExperiment('paywall_test'));

    expect(share).toBeGreaterThan(2700);
    expect(share).toBeLessThan(3300);
  });

  it('keeps experiments of one layer apart and of different layers independent', () => {
    const config = active({
      layers: ['default', 'onboarding'],
      experiments: {
        first: experiment({ traffic: { from: 0, to: 50 } }),
        second: experiment({
          traffic: { from: 50, to: 100 },
          variants: {
            short: { weight: 50, values: { daily_goal_minutes: 5 } },
            long: { weight: 50, values: { daily_goal_minutes: 20 } },
          },
        }),
        other_layer: experiment({
          layer: 'onboarding',
          traffic: { from: 0, to: 50 },
          variants: {
            off: { weight: 50, values: { ads_enabled: false } },
            on: { weight: 50, values: { ads_enabled: true } },
          },
        }),
      },
    });

    const both = (a: string, b: string) => (r: EvaluatedConfig) => inExperiment(a)(r) && inExperiment(b)(r);
    const independent = count(config, both('first', 'other_layer'));

    expect(count(config, both('first', 'second'))).toBe(0);
    expect(independent).toBeGreaterThan(2200);
    expect(independent).toBeLessThan(2800);
  });

  it('keeps the holdout out of every experiment, except forced testers', () => {
    const config = active({ holdout: { percent: 10 }, experiments: { paywall_test: experiment() } });

    const outside = count(config, (r) => r.experiments.length === 0);
    expect(outside).toBeGreaterThan(800);
    expect(outside).toBeLessThan(1200);

    const heldOut = userIds.find((userId) => evaluateConfig(config, context({ userId })).experiments.length === 0);
    const withTester = active({
      holdout: { percent: 10 },
      experiments: { paywall_test: experiment({ forced: { [heldOut as string]: 'trial' } }) },
    });

    expect(evaluateConfig(withTester, context({ userId: heldOut as string })).experiments).toEqual([
      { key: 'paywall_test', variant: 'trial', parameters: ['paywall_variant'], forced: true },
    ]);
  });

  it('targets new users only when asked', () => {
    const config = active({ experiments: { paywall_test: experiment({ targeting: { new_users_only: true } }) } });

    const before = context({ userCreatedAt: new Date('2026-10-29T00:00:00.000Z') });
    const after = context({ userCreatedAt: new Date('2026-10-31T00:00:00.000Z') });

    expect(evaluateConfig(config, before).experiments).toEqual([]);
    expect(evaluateConfig(config, after).experiments).toHaveLength(1);
  });

  it('applies targeting conditions', () => {
    const config = active({
      experiments: { paywall_test: experiment({ targeting: { platforms: ['android'], min_app_version: '2.0' } }) },
    });

    expect(evaluateConfig(config, context()).experiments).toEqual([]);
    expect(evaluateConfig(config, context({ appVersion: '2.0.1' })).experiments).toHaveLength(1);
    expect(evaluateConfig(config, context({ appVersion: '2.0.1', platform: 'ios' })).experiments).toEqual([]);
  });

  it('ignores drafts and stopped experiments', () => {
    const config = active({
      parameters: { paywall_variant: { value: 'classic' } },
      experiments: {
        draft: experiment({ status: 'draft' }),
        old: experiment({ status: 'stopped', stopped_at: '2026-10-31T00:00:00.000Z' }),
      },
    });

    expect(evaluateConfig(config, context())).toEqual({
      version: 7,
      values: { paywall_variant: 'classic' },
      experiments: [],
    });
  });
});