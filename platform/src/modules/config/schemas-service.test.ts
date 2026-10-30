import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedApp } from '../../../test/helpers.js';
import { pool } from '../../core/db.js';
import type { ParameterSchema } from './parameters.js';
import { getParameterSchema, uploadParameterSchema } from './schemas-service.js';

const schema: ParameterSchema = {
  format_version: 1,
  parameters: {
    daily_goal_minutes: { type: 'integer', min: 5, max: 60, default: 10 },
  },
};

let appId: string;

beforeEach(async () => {
  await resetDatabase();
  appId = await seedApp();
});

afterAll(async () => {
  await pool.end();
});

describe('uploadParameterSchema', () => {
  it('stores a new schema and skips an identical one', async () => {
    expect(await uploadParameterSchema(appId, schema)).toEqual({ status: 'created', parameters: 1 });
    expect(await uploadParameterSchema(appId, schema)).toEqual({ status: 'unchanged', parameters: 1 });
  });

  it('rejects an invalid schema', async () => {
    const broken = { format_version: 1, parameters: { daily_goal: { type: 'integer' } } };

    await expect(uploadParameterSchema(appId, broken)).rejects.toMatchObject({
      statusCode: 400,
      code: 'invalid_parameter_schema',
    });
  });

  it('rejects breaking changes to the uploaded schema', async () => {
    await uploadParameterSchema(appId, schema);
    const breaking: ParameterSchema = {
      format_version: 1,
      parameters: { daily_goal_minutes: { type: 'string', max_length: 8, default: '10' } },
    };

    await expect(uploadParameterSchema(appId, breaking)).rejects.toMatchObject({
      statusCode: 409,
      code: 'incompatible_parameter_schema',
    });
  });
});

describe('getParameterSchema', () => {
  it('is null before the first upload', async () => {
    expect(await getParameterSchema(appId)).toBeNull();
  });

  it('returns the latest version', async () => {
    await uploadParameterSchema(appId, schema);
    const next: ParameterSchema = {
      format_version: 1,
      parameters: { ...schema.parameters, ads_enabled: { type: 'boolean', default: true } },
    };
    await uploadParameterSchema(appId, next);

    expect(await getParameterSchema(appId)).toEqual(next);
  });
});