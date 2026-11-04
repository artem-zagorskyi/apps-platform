import { describe, expect, it } from 'vitest';
import { type ConfigDocument, configDocumentFormat } from './document.js';
import { bucket, type EvaluationContext, evaluateConfig, explainConfig } from './evaluate.js';

const TESTER = '00000000-0000-4000-8000-000000000001';

const ctx = (overrides: Partial<EvaluationContext> = {}): EvaluationContext => ({
  appId: 'app-1',
  userId: 'user-1',
  platform: 'android',
  appVersion: '1.0.0',
  country: null,
  linked: false,
  userCreatedAt: new Date('2026-10-01T00:00:00Z'),
  ...overrides,
});

// The first test user id that passes `test`
function userWhere(test: (userId: string) => boolean): string {
  for (let i = 0; i < 100_000; i++) {
    const id = `user-${i}`;
    if (test(id)) return id;
  }
  throw new Error('No such user');
}

const document: ConfigDocument = configDocumentFormat.parse({
  format_version: 1,
  parameters: {
    ads_enabled: { force: false },
    daily_goal_minutes: {
      value: 15,
      rules: [
        { when: { platforms: ['ios'] }, value: 10 },
        { when: { min_app_version: '1.2.0' }, value: 20 },
      ],
    },
    start_text: { rules: [{ when: { linked: true }, value: 'Welcome back' }] },
  },
  experiments: {
    paywall_test: {
      description: 'Trial first',
      status: 'running',
      layer: 'default',
      traffic: { from: 0, to: 50 },
      variants: {
        control: { weight: 50, values: { paywall_variant: 'classic' } },
        trial: { weight: 50, values: { paywall_variant: 'trial_first' } },
      },
      forced: { [TESTER]: 'trial' },
      started_at: '2026-10-15T00:00:00.000Z',
    },
    ads_test: {
      description: 'Ads on or off',
      status: 'running',
      layer: 'default',
      traffic: { from: 50, to: 100 },
      targeting: { countries: ['DE'] },
      variants: {
        off: { weight: 50, values: { ads_enabled: false } },
        on: { weight: 50, values: { ads_enabled: true } },
      },
      started_at: '2026-10-15T00:00:00.000Z',
    },
    old_test: {
      description: 'Finished',
      status: 'stopped',
      layer: 'default',
      traffic: { from: 0, to: 10 },
      variants: {
        a: { weight: 50, values: { theme: 'light' } },
        b: { weight: 50, values: { theme: 'dark' } },
      },
      started_at: '2026-09-01T00:00:00.000Z',
      stopped_at: '2026-09-20T00:00:00.000Z',
    },
  },
});
const active = { number: 7, document };

const inPaywallTraffic = (id: string) => bucket(`layer:default:${id}`) < 5000;
const decision = (userId: string, key: string, overrides: Partial<EvaluationContext> = {}) =>
  explainConfig(active, ctx({ userId, ...overrides })).experiments.find((e) => e.key === key);
const parameter = (overrides: Partial<EvaluationContext>, name: string) =>
  explainConfig(active, ctx(overrides)).parameters.find((p) => p.name === name);

describe('explainConfig', () => {
  it('names the experiment and variant behind a value', () => {
    const userId = userWhere(inPaywallTraffic);
    const explanation = explainConfig(active, ctx({ userId }));
    const paywall = explanation.experiments.find((e) => e.key === 'paywall_test');

    expect(paywall).toMatchObject({ outcome: 'assigned', parameters: ['paywall_variant'] });
    const variant = paywall?.outcome === 'assigned' ? paywall.variant : undefined;
    expect(explanation.parameters.find((p) => p.name === 'paywall_variant')).toMatchObject({
      source: { kind: 'experiment', experiment: 'paywall_test', variant },
    });
    expect(evaluateConfig(active, ctx({ userId })).experiments).toEqual([
      { key: 'paywall_test', variant, parameters: ['paywall_variant'] },
    ]);
  });

  it('says why a user is outside an experiment', () => {
    const userId = userWhere((id) => !inPaywallTraffic(id));

    expect(decision(userId, 'paywall_test')).toEqual({
      key: 'paywall_test',
      outcome: 'outside_traffic',
      bucket: bucket(`layer:default:${userId}`),
      from: 0,
      to: 50,
    });
    expect(decision(userId, 'ads_test')).toEqual({ key: 'ads_test', outcome: 'not_targeted', problems: ['country is unknown'] });
    expect(decision(userId, 'ads_test', { country: 'US' })).toMatchObject({ problems: ['country US is not DE'] });
    expect(decision(userId, 'old_test')).toEqual({ key: 'old_test', outcome: 'not_running', status: 'stopped' });
  });

  it('shows an experiment overridden by force, which the app does not hear of', () => {
    const userId = userWhere((id) => !inPaywallTraffic(id));

    expect(decision(userId, 'ads_test', { country: 'DE' })).toMatchObject({ outcome: 'assigned', parameters: [] });
    expect(parameter({ userId, country: 'DE' }, 'ads_enabled')).toMatchObject({ value: false, source: { kind: 'force' } });
    expect(evaluateConfig(active, ctx({ userId, country: 'DE' })).experiments).toEqual([]);
  });

  it('names the matching rule and why earlier rules did not match', () => {
    expect(parameter({ appVersion: '1.3.0' }, 'daily_goal_minutes')).toEqual({
      name: 'daily_goal_minutes',
      value: 20,
      source: { kind: 'rule', index: 1 },
      skippedRules: [{ index: 0, problems: ['platform android is not ios'] }],
    });
    expect(parameter({}, 'daily_goal_minutes')).toMatchObject({ value: 15, source: { kind: 'value' } });
  });

  it('falls back to the built-in default when nothing applies', () => {
    expect(parameter({}, 'start_text')).toEqual({
      name: 'start_text',
      value: undefined,
      source: { kind: 'default' },
      skippedRules: [{ index: 0, problems: ['has no linked account'] }],
    });
  });

  it('puts testers into their variant regardless of traffic', () => {
    expect(decision(TESTER, 'paywall_test')).toMatchObject({ outcome: 'forced', variant: 'trial' });
  });

  it('keeps holdout users out of every experiment', () => {
    const withHoldout = { number: 8, document: { ...document, holdout: { percent: 50 } } };
    const userId = userWhere((id) => bucket(`holdout:app-1:${id}`) < 5000);
    const explanation = explainConfig(withHoldout, ctx({ userId }));

    expect(explanation.holdout).toMatchObject({ percent: 50, inHoldout: true });
    expect(explanation.experiments.find((e) => e.key === 'paywall_test')).toEqual({ key: 'paywall_test', outcome: 'holdout' });
  });

  it('explains an empty config before the first publish', () => {
    expect(explainConfig(null, ctx())).toEqual({
      version: 0,
      holdout: { percent: 0, bucket: null, inHoldout: false },
      experiments: [],
      parameters: [],
    });
  });
});