import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedApp } from '../../../test/helpers.js';
import { pool } from '../../core/db.js';
import type { ConfigDocument } from './document.js';
import type { ParameterSchema } from './parameters.js';
import { uploadParameterSchema } from './schemas-service.js';
import { getConfigVersion, publishConfig } from './versions-service.js';

const schema: ParameterSchema = {
  format_version: 1,
  parameters: {
    paywall_variant: { type: 'enum', values: ['classic', 'trial_first'], default: 'classic' },
    daily_goal_minutes: { type: 'integer', min: 5, max: 60, default: 10 },
  },
};

const base: ConfigDocument = {
  format_version: 1,
  holdout: { percent: 0 },
  layers: ['default'],
  parameters: { daily_goal_minutes: { value: 15 } },
  experiments: {},
};

function withExperiment(status: 'draft' | 'running' | 'stopped'): ConfigDocument {
  return {
    ...base,
    experiments: {
      paywall_test: {
        description: 'Paywall test',
        status,
        layer: 'default',
        traffic: { from: 0, to: 50 },
        variants: {
          control: { weight: 50, values: { paywall_variant: 'classic' } },
          trial: { weight: 50, values: { paywall_variant: 'trial_first' } },
        },
      },
    },
  };
}

let appId: string;

beforeEach(async () => {
  await resetDatabase();
  appId = await seedApp();
  await uploadParameterSchema(appId, schema);
});

afterAll(async () => {
  await pool.end();
});

describe('publishConfig', () => {
  it('numbers versions and skips an identical document', async () => {
    const longer: ConfigDocument = { ...base, parameters: { daily_goal_minutes: { value: 20 } } };

    expect(await publishConfig(appId, base)).toEqual({ status: 'created', version: 1 });
    expect(await publishConfig(appId, base)).toEqual({ status: 'unchanged', version: 1 });
    expect(await publishConfig(appId, longer, { comment: 'Longer goal' })).toEqual({
      status: 'created',
      version: 2,
    });

    expect(await getConfigVersion(appId)).toMatchObject({
      number: 2,
      comment: 'Longer goal',
      document: longer,
    });
    expect((await getConfigVersion(appId, 1))?.document).toEqual(base);
  });

  it('rejects an invalid document', async () => {
    const tooLong = { ...base, parameters: { daily_goal_minutes: { value: 100 } } };

    await expect(publishConfig(appId, { format_version: 2 })).rejects.toMatchObject({
      statusCode: 400,
      code: 'invalid_config',
    });
    await expect(publishConfig(appId, tooLong)).rejects.toMatchObject({
      statusCode: 400,
      code: 'invalid_config',
    });
  });

  it('rejects changes not allowed after an experiment started', async () => {
    await publishConfig(appId, withExperiment('running'));

    await expect(publishConfig(appId, withExperiment('draft'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_config_change',
    });
  });

  it('stamps start and stop times', async () => {
    await publishConfig(appId, withExperiment('running'), { now: new Date('2026-10-30T10:00:00.000Z') });
    await publishConfig(appId, withExperiment('stopped'), { now: new Date('2026-11-05T10:00:00.000Z') });

    const latest = await getConfigVersion(appId);

    expect(latest?.document.experiments.paywall_test).toMatchObject({
      started_at: '2026-10-30T10:00:00.000Z',
      stopped_at: '2026-11-05T10:00:00.000Z',
    });
  });

  it('treats the same file published again as unchanged', async () => {
    await publishConfig(appId, withExperiment('running'));

    // The file has no started_at; the stored version has one
    expect(await publishConfig(appId, withExperiment('running'))).toEqual({
      status: 'unchanged',
      version: 1,
    });
  });

  it('gives parallel publishes their own numbers', async () => {
    const results = await Promise.all([
      publishConfig(appId, base),
      publishConfig(appId, { ...base, parameters: {} }),
    ]);

    expect(results.map((r) => r.version).sort()).toEqual([1, 2]);
  });
});

describe('getConfigVersion', () => {
  it('is null before the first publish', async () => {
    expect(await getConfigVersion(appId)).toBeNull();
    expect(await getConfigVersion(appId, 1)).toBeNull();
  });
});