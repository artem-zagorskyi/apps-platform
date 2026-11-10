import { describe, expect, it } from 'vitest';
import { diffDocuments, forceWarnings, rebaseDocument } from './diff.js';
import { configDocumentFormat } from './document.js';

const doc = (raw: object) => configDocumentFormat.parse({ format_version: 1, ...raw });
const experiment = (status: string, extra: object = {}) => ({
  description: 'Paywall',
  status,
  layer: 'default',
  traffic: { from: 0, to: 50 },
  variants: { control: { weight: 50, values: { paywall: 'a' } }, trial: { weight: 50, values: { paywall: 'b' } } },
  ...extra,
});

describe('diffDocuments', () => {
  it('lists changed parameter parts and experiment fields, not the server stamps', () => {
    const before = doc({ parameters: { goal: { value: 15 }, old: { value: 1 } }, experiments: { pay: experiment('running', { started_at: '2026-11-01T00:00:00Z' }) } });
    const after = doc({
      holdout: { percent: 5 },
      parameters: { goal: { value: 20, force: 10 }, banner: { value: 'hi' } },
      experiments: { pay: experiment('stopped', { started_at: '2026-11-01T00:00:00Z', stopped_at: '2026-11-09T00:00:00Z' }) },
    });
    expect(diffDocuments(before, after)).toEqual([
      { path: 'holdout.percent', kind: 'changed', before: 0, after: 5 },
      { path: 'parameters.banner.value', kind: 'added', after: 'hi' },
      { path: 'parameters.goal.force', kind: 'added', after: 10 },
      { path: 'parameters.goal.value', kind: 'changed', before: 15, after: 20 },
      { path: 'parameters.old.value', kind: 'removed', before: 1 },
      { path: 'experiments.pay.status', kind: 'changed', before: 'running', after: 'stopped' },
    ]);
  });

  it('compares with nothing before the first publish', () => {
    expect(diffDocuments(null, doc({ parameters: { goal: { value: 15 } } }))).toEqual([
      { path: 'parameters.goal.value', kind: 'added', after: 15 },
    ]);
  });
});

describe('rebaseDocument', () => {
  it('keeps what the draft changed and takes the rest from the newer live version', () => {
    const base = doc({ parameters: { goal: { value: 15 }, banner: { value: 'a' } } });
    const live = doc({ holdout: { percent: 5 }, parameters: { goal: { value: 15 }, banner: { value: 'b' } } });
    const draft = doc({ parameters: { goal: { value: 20 }, banner: { value: 'a' } } });
    const { document, conflicts } = rebaseDocument(base, live, draft);
    expect(document.holdout.percent).toBe(5);
    expect(document.parameters).toEqual({ goal: { value: 20 }, banner: { value: 'b' } });
    expect(conflicts).toEqual([]);
  });

  it('reports parts changed on both sides; the draft wins', () => {
    const base = doc({ parameters: { goal: { value: 15 } } });
    const live = doc({ parameters: { goal: { value: 18 } } });
    const draft = doc({ parameters: { goal: { value: 20 } } });
    expect(rebaseDocument(base, live, draft)).toEqual({
      document: doc({ parameters: { goal: { value: 20 } } }),
      conflicts: ['parameters.goal'],
    });
  });

  it('keeps live experiments the draft did not touch, with their start time', () => {
    const base = doc({ experiments: { pay: experiment('draft') } });
    const live = doc({ experiments: { pay: experiment('running', { started_at: '2026-11-08T00:00:00Z' }) } });
    const draft = doc({ parameters: { goal: { value: 20 } }, experiments: { pay: experiment('draft') } });
    const { document, conflicts } = rebaseDocument(base, live, draft);
    expect(document.experiments.pay?.status).toBe('running');
    expect(document.experiments.pay?.started_at).toBe('2026-11-08T00:00:00Z');
    expect(conflicts).toEqual([]);
  });

  it('removes a part the draft removed', () => {
    const base = doc({ parameters: { goal: { value: 15 }, banner: { value: 'a' } } });
    const draft = doc({ parameters: { goal: { value: 15 } } });
    expect(rebaseDocument(base, base, draft).document.parameters).toEqual({ goal: { value: 15 } });
  });
});

describe('forceWarnings', () => {
  it('warns when a force overrides a running experiment', () => {
    const document = doc({ parameters: { paywall: { force: 'a' } }, experiments: { pay: experiment('running') } });
    expect(forceWarnings(document)).toEqual([
      'parameters.paywall: forced for everyone, so running experiment pay no longer decides it',
    ]);
    expect(forceWarnings(doc({ parameters: { paywall: { force: 'a' } }, experiments: { pay: experiment('draft') } }))).toEqual([]);
  });
});
