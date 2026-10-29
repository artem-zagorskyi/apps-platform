import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedApp } from '../../../test/helpers.js';
import { pool } from '../../core/db.js';
import { checkEvent, type TrackingPlan } from './plan.js';
import { clearPlanCache, getEffectivePlan, uploadTrackingPlan } from './plans-service.js';

const appPlan: TrackingPlan = {
  format_version: 1,
  events: {
    lesson_completed: {
      category: 'analytics',
      description: 'The person finished a lesson',
      properties: {
        mistakes: { type: 'integer', required: true, min: 0 },
      },
    },
  },
};

let appId: string;

beforeEach(async () => {
  await resetDatabase();
  clearPlanCache();
  appId = await seedApp();
});

afterAll(async () => {
  await pool.end();
});

describe('uploadTrackingPlan', () => {
  it('stores a new plan and skips an identical one', async () => {
    expect(await uploadTrackingPlan(appId, appPlan)).toEqual({ status: 'created', events: 1 });
    expect(await uploadTrackingPlan(appId, appPlan)).toEqual({ status: 'unchanged', events: 1 });
  });

  it('rejects an invalid plan', async () => {
    const broken = { format_version: 1, events: { LessonCompleted: {} } };

    await expect(uploadTrackingPlan(appId, broken)).rejects.toMatchObject({
      statusCode: 400,
      code: 'invalid_tracking_plan',
    });
  });

  it('rejects names of standard platform events', async () => {
    const clash: TrackingPlan = {
      format_version: 1,
      events: { app_opened: { category: 'analytics', description: 'Mine', properties: {} } },
    };

    await expect(uploadTrackingPlan(appId, clash)).rejects.toMatchObject({
      code: 'invalid_tracking_plan',
    });
  });

  it('rejects breaking changes to the uploaded plan', async () => {
    await uploadTrackingPlan(appId, appPlan);
    const breaking: TrackingPlan = {
      format_version: 1,
      events: {
        lesson_completed: {
          category: 'analytics',
          description: 'The person finished a lesson',
          properties: { mistakes: { type: 'number', required: true } },
        },
      },
    };

    await expect(uploadTrackingPlan(appId, breaking)).rejects.toMatchObject({
      statusCode: 409,
      code: 'incompatible_tracking_plan',
    });
  });
});

describe('getEffectivePlan', () => {
  it('combines platform events with the app events', async () => {
    await uploadTrackingPlan(appId, appPlan);

    const plan = await getEffectivePlan(appId);

    expect(checkEvent(plan, 'app_opened', { cold_start: false }).ok).toBe(true);
    expect(checkEvent(plan, 'lesson_completed', { mistakes: 2 }).ok).toBe(true);
  });

  it('has only platform events before the app uploads a plan', async () => {
    const plan = await getEffectivePlan(appId);

    expect(checkEvent(plan, 'lesson_completed', { mistakes: 2 }).ok).toBe(false);
    expect(checkEvent(plan, 'app_opened', { cold_start: true }).ok).toBe(true);
  });
});