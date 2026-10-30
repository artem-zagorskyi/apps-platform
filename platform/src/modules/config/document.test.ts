import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  type ConfigDocument,
  configDocumentFormat,
  documentErrors,
  type Experiment,
  lifecycleErrors,
  stampLifecycle,
} from './document.js';
import type { ParameterSchema } from './parameters.js';

const tester = '0190a000-0000-7000-8000-000000000001';

const schema: ParameterSchema = {
  format_version: 1,
  parameters: {
    paywall_variant: { type: 'enum', values: ['classic', 'trial_first'], default: 'classic' },
    daily_goal_minutes: { type: 'integer', min: 5, max: 60, default: 10 },
    ads_enabled: { type: 'boolean', default: true },
  },
};

function experiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    description: 'Paywall test',
    status: 'running',
    layer: 'default',
    traffic: { from: 0, to: 50 },
    variants: {
      control: { weight: 50, values: { paywall_variant: 'classic' } },
      trial: { weight: 50, values: { paywall_variant: 'trial_first' } },
    },
    ...overrides,
  };
}

function config(overrides: Partial<ConfigDocument> = {}): ConfigDocument {
  return {
    format_version: 1,
    holdout: { percent: 0 },
    layers: ['default'],
    parameters: {},
    experiments: {},
    ...overrides,
  };
}

describe('configDocumentFormat', () => {
  it('fills defaults for a minimal document', () => {
    expect(configDocumentFormat.parse({ format_version: 1 })).toEqual(config());
  });

  it('accepts a full document', () => {
    const document = config({
      parameters: {
        ads_enabled: { force: false },
        daily_goal_minutes: {
          value: 15,
          rules: [
            { when: { user_ids: [tester] }, value: 60 },
            { when: { platforms: ['ios'], min_app_version: '1.2', countries: ['DE'] }, value: 10 },
          ],
        },
      },
      experiments: {
        paywall_test: experiment({
          targeting: { new_users_only: true, linked: false },
          forced: { [tester]: 'trial' },
          primary_metric: 'purchase_completed',
        }),
      },
    });

    expect(configDocumentFormat.safeParse(document).success).toBe(true);
  });

  it.each([
    ['an unknown key', { format_version: 1, holdut: { percent: 5 } }],
    ['a rule without conditions', { format_version: 1, parameters: { a: { rules: [{ when: {}, value: 1 }] } } }],
    ['a lowercase country', { format_version: 1, parameters: { a: { rules: [{ when: { countries: ['de'] }, value: 1 }] } } }],
    ['a malformed version', { format_version: 1, parameters: { a: { rules: [{ when: { min_app_version: 'v1' }, value: 1 }] } } }],
    ['an unknown platform', { format_version: 1, parameters: { a: { rules: [{ when: { platforms: ['web'] }, value: 1 }] } } }],
    ['traffic with three decimals', { format_version: 1, experiments: { t: { ...experiment(), traffic: { from: 0, to: 33.333 } } } }],
    ['a holdout above 50 percent', { format_version: 1, holdout: { percent: 60 } }],
    ['an unknown status', { format_version: 1, experiments: { t: { ...experiment(), status: 'paused' } } }],
  ])('rejects %s', (_, document) => {
    expect(configDocumentFormat.safeParse(document).success).toBe(false);
  });
});

describe('compareVersions', () => {
  it('compares numerically and ignores suffixes', () => {
    expect(compareVersions('1.10', '1.9')).toBe(1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1')).toBe(-1);
  });
});

describe('documentErrors', () => {
  it('accepts a valid document', () => {
    const document = config({
      parameters: { daily_goal_minutes: { value: 15 } },
      experiments: { paywall_test: experiment() },
    });

    expect(documentErrors(document, schema)).toEqual([]);
  });

  it('refuses undeclared parameters and values that do not fit', () => {
    const document = config({
      parameters: {
        streaks_enabled: { value: true },
        daily_goal_minutes: { value: 100, rules: [{ when: { linked: true }, value: 'ten' }] },
        ads_enabled: { force: 'off' },
      },
    });

    expect(documentErrors(document, schema)).toEqual([
      "parameters.streaks_enabled: not declared in the app's parameter schema",
      'parameters.daily_goal_minutes.value: above_max',
      'parameters.daily_goal_minutes.rules.0.value: not_integer',
      'parameters.ads_enabled.force: not_boolean',
    ]);
  });

  it('refuses every parameter before the app uploaded its schema', () => {
    const document = config({ parameters: { ads_enabled: { value: false } } });

    expect(documentErrors(document, null)).toEqual([
      "parameters.ads_enabled: not declared in the app's parameter schema",
    ]);
  });

  it('refuses an empty version range', () => {
    const document = config({
      parameters: {
        ads_enabled: {
          rules: [{ when: { min_app_version: '2.0', max_app_version: '1.9.9' }, value: false }],
        },
      },
    });

    expect(documentErrors(document, schema)).toEqual([
      'parameters.ads_enabled.rules.0.when: min_app_version is above max_app_version',
    ]);
  });

  it('checks experiments', () => {
    const document = config({
      experiments: {
        broken: experiment({
          layer: 'onboarding',
          traffic: { from: 50, to: 50 },
          variants: {
            control: { weight: 60, values: { paywall_variant: 'classic' } },
            trial: { weight: 30, values: { paywall_variant: 'video', daily_goal_minutes: 20 } },
          },
          forced: { [tester]: 'other' },
        }),
      },
    });

    expect(documentErrors(document, schema)).toEqual([
      'experiments.broken.layer: onboarding is not in layers',
      'experiments.broken.traffic: from must be below to',
      'experiments.broken.variants: weights add up to 90, not 100',
      'experiments.broken.variants.control: must set the same parameters as the other variants',
      'experiments.broken.variants.trial.values.paywall_variant: not_allowed_value',
      `experiments.broken.forced.${tester}: no variant other`,
    ]);
  });

  it('refuses running experiments that compete for users or parameters', () => {
    const document = config({
      layers: ['default', 'onboarding'],
      experiments: {
        first: experiment(),
        second: experiment({ traffic: { from: 40, to: 60 } }),
        other_layer: experiment({ layer: 'onboarding' }),
        draft: experiment({ status: 'draft' }),
      },
    });

    expect(documentErrors(document, schema)).toEqual([
      'experiments.first, experiments.second: traffic overlaps in layer default',
      'parameters.paywall_variant: set by running experiments first and second',
      'parameters.paywall_variant: set by running experiments first and other_layer',
    ]);
  });
});

describe('lifecycleErrors', () => {
  const running = config({ experiments: { paywall_test: experiment() } });

  it('allows starting, growing traffic, renaming, testers and stopping', () => {
    const grown = config({
      experiments: {
        paywall_test: experiment({
          traffic: { from: 0, to: 80 },
          description: 'Renamed',
          forced: { [tester]: 'trial' },
        }),
      },
    });
    const stopped = config({
      experiments: { paywall_test: experiment({ traffic: { from: 0, to: 80 }, status: 'stopped' }) },
    });

    expect(lifecycleErrors(null, running)).toEqual([]);
    expect(lifecycleErrors(running, grown)).toEqual([]);
    expect(lifecycleErrors(grown, stopped)).toEqual([]);
  });

  it('refuses changing how users are assigned', () => {
    const changed = config({
      layers: ['default', 'other'],
      experiments: {
        paywall_test: experiment({
          layer: 'other',
          traffic: { from: 10, to: 40 },
          variants: {
            control: { weight: 50, values: { paywall_variant: 'classic' } },
            trial: { weight: 50, values: { paywall_variant: 'classic' } },
          },
          targeting: { platforms: ['android'] },
          primary_metric: 'lesson_completed',
        }),
      },
    });

    expect(lifecycleErrors(running, changed)).toEqual([
      'experiments.paywall_test.layer: cannot change after the start',
      'experiments.paywall_test.variants: cannot change after the start',
      'experiments.paywall_test.targeting: cannot change after the start',
      'experiments.paywall_test.primary_metric: cannot change after the start',
      'experiments.paywall_test.traffic.from: cannot change after the start',
      'experiments.paywall_test.traffic.to: can only grow while the experiment runs',
    ]);
  });

  it('refuses restarting, going back to draft and removing', () => {
    const stopped = config({ experiments: { paywall_test: experiment({ status: 'stopped' }) } });
    const draft = config({ experiments: { paywall_test: experiment({ status: 'draft' }) } });

    expect(lifecycleErrors(stopped, running)).toEqual([
      'experiments.paywall_test: stopped experiments cannot run again; create a new one',
    ]);
    expect(lifecycleErrors(running, draft)).toEqual([
      'experiments.paywall_test: a started experiment cannot go back to draft; stop it',
    ]);
    expect(lifecycleErrors(stopped, config())).toEqual([
      'experiments.paywall_test: started experiments stay in the config; stop it instead of removing',
    ]);
  });

  it('allows removing drafts but not stopping them', () => {
    const draft = config({ experiments: { paywall_test: experiment({ status: 'draft' }) } });
    const stopped = config({ experiments: { paywall_test: experiment({ status: 'stopped' }) } });

    expect(lifecycleErrors(draft, config())).toEqual([]);
    expect(lifecycleErrors(draft, stopped)).toEqual([
      'experiments.paywall_test: never ran; remove it instead of stopping',
    ]);
  });

  it('refuses changing the holdout while experiments run', () => {
    const stoppedWithHoldout = config({
      holdout: { percent: 5 },
      experiments: { paywall_test: experiment({ status: 'stopped' }) },
    });

    expect(lifecycleErrors(running, { ...running, holdout: { percent: 5 } })).toEqual([
      'holdout.percent: cannot change while experiments are running',
    ]);
    expect(lifecycleErrors(config(), config({ holdout: { percent: 5 } }))).toEqual([]);
    // Stopping the experiments and changing the holdout in one publish is fine
    expect(lifecycleErrors(running, stoppedWithHoldout)).toEqual([]);
  });
});

describe('stampLifecycle', () => {
  const start = new Date('2026-10-30T10:00:00.000Z');
  const later = new Date('2026-11-05T10:00:00.000Z');

  it('records when an experiment starts and stops', () => {
    const started = stampLifecycle(null, config({ experiments: { paywall_test: experiment() } }), start);
    const still = stampLifecycle(started, config({ experiments: { paywall_test: experiment() } }), later);
    const stopped = stampLifecycle(
      still,
      config({ experiments: { paywall_test: experiment({ status: 'stopped' }) } }),
      later,
    );

    expect(started.experiments.paywall_test).toMatchObject({ started_at: start.toISOString() });
    expect(started.experiments.paywall_test).not.toHaveProperty('stopped_at');
    expect(still.experiments.paywall_test?.started_at).toBe(start.toISOString());
    expect(stopped.experiments.paywall_test).toMatchObject({
      started_at: start.toISOString(),
      stopped_at: later.toISOString(),
    });
  });

  it('ignores times in the uploaded file and leaves drafts without them', () => {
    const uploaded = config({
      experiments: {
        paywall_test: experiment({ started_at: '2020-01-01T00:00:00.000Z' }),
        draft: experiment({ status: 'draft', started_at: '2020-01-01T00:00:00.000Z' }),
      },
    });

    const stamped = stampLifecycle(null, uploaded, start);

    expect(stamped.experiments.paywall_test?.started_at).toBe(start.toISOString());
    expect(stamped.experiments.draft).not.toHaveProperty('started_at');
  });
});