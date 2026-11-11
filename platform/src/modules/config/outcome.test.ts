import { describe, expect, it } from 'vitest';
import { type ConfigDocument, configDocumentFormat, documentErrors, lifecycleErrors } from './document.js';

const SCHEMA = { format_version: 1 as const, parameters: { paywall: { type: 'string' as const, default: 'a', max_length: 20 } } };

function doc(experiment: object): ConfigDocument {
  return configDocumentFormat.parse({
    format_version: 1,
    layers: ['main'],
    experiments: {
      test: {
        description: 'Paywall',
        layer: 'main',
        traffic: { from: 0, to: 50 },
        variants: { control: { weight: 50, values: { paywall: 'a' } }, trial: { weight: 50, values: { paywall: 'b' } } },
        ...experiment,
      },
    },
  });
}

describe('experiment outcome', () => {
  const running = doc({ status: 'running' });

  it('is kept when the experiment stops', () => {
    const stopped = doc({ status: 'stopped', outcome: { reason: 'Trial wins', applied_variant: 'trial' } });
    expect(documentErrors(stopped, SCHEMA)).toEqual([]);
    expect(lifecycleErrors(running, stopped)).toEqual([]);
    // Stopping without an outcome stays allowed, as for uploaded files
    expect(lifecycleErrors(running, doc({ status: 'stopped' }))).toEqual([]);
  });

  it('belongs only to stopped experiments and names a real variant', () => {
    expect(documentErrors(doc({ status: 'running', outcome: { reason: 'Too early' } }), SCHEMA)).toEqual([
      'experiments.test.outcome: only a stopped experiment has an outcome',
    ]);
    expect(documentErrors(doc({ status: 'stopped', outcome: { reason: 'Wins', applied_variant: 'annual' } }), SCHEMA)).toEqual([
      'experiments.test.outcome.applied_variant: no variant annual',
    ]);
    expect(() => doc({ status: 'stopped', outcome: { reason: 'x' } })).toThrow();
  });

  it('cannot change once stopped', () => {
    const stopped = doc({ status: 'stopped', outcome: { reason: 'Trial wins', applied_variant: 'trial' } });
    expect(lifecycleErrors(stopped, stopped)).toEqual([]);
    expect(lifecycleErrors(stopped, doc({ status: 'stopped', outcome: { reason: 'Control wins' } }))).toEqual([
      'experiments.test.outcome: cannot change once stopped',
    ]);
  });
});

describe('guardrail metrics', () => {
  it('take events and built-in metrics, once each, and are fixed after the start', () => {
    const guarded = doc({
      status: 'running',
      primary_metric: 'purchase',
      guardrail_metrics: [{ metric: 'retention:d1' }, { metric: 'subscription_cancelled', lower_is_better: true }],
    });
    expect(documentErrors(guarded, SCHEMA)).toEqual([]);
    expect(lifecycleErrors(guarded, guarded)).toEqual([]);

    const changed = doc({ status: 'running', primary_metric: 'purchase', guardrail_metrics: [{ metric: 'retention:d1' }] });
    expect(lifecycleErrors(guarded, changed)).toEqual(['experiments.test.guardrail_metrics: cannot change after the start']);

    const twice = doc({ status: 'draft', primary_metric: 'purchase', guardrail_metrics: [{ metric: 'purchase' }] });
    expect(documentErrors(twice, SCHEMA)).toEqual([
      'experiments.test.guardrail_metrics: a metric is listed twice or is also the primary metric',
    ]);
    expect(() => doc({ status: 'draft', primary_metric: 'retention:d30' })).toThrow();
  });
});
