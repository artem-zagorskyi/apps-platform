import { describe, expect, it } from 'vitest';
import { checkEvent, compatibilityErrors, type TrackingPlan } from './plan.js';
import { getPlatformPlan } from './plans-service.js';

const plan: TrackingPlan = {
  format_version: 1,
  events: {
    lesson_completed: {
      category: 'analytics',
      description: 'The person finished a lesson',
      properties: {
        lesson_id: { type: 'string', required: true, max_length: 8, description: 'Lesson id' },
        mistakes: { type: 'integer', required: true, min: 0 },
        result: { type: 'enum', required: true, values: ['passed', 'failed'] },
        duration_seconds: { type: 'number', required: false, min: 0 },
        old_score: { type: 'integer', required: true, deprecated: true },
      },
    },
    purchase_completed: {
      category: 'essential',
      description: 'A purchase went through',
      properties: {},
    },
  },
};

const valid = { lesson_id: 'l5', mistakes: 3, result: 'passed' };

describe('checkEvent', () => {
  it('accepts a valid event and takes the category from the plan', () => {
    expect(checkEvent(plan, 'lesson_completed', valid)).toEqual({ ok: true, category: 'analytics' });
    expect(checkEvent(plan, 'purchase_completed', {})).toEqual({ ok: true, category: 'essential' });
  });

  it('accepts a missing optional or deprecated property', () => {
    expect(checkEvent(plan, 'lesson_completed', valid).ok).toBe(true);
    expect(checkEvent(plan, 'lesson_completed', { ...valid, duration_seconds: 12.5 }).ok).toBe(true);
  });

  it.each([
    ['unknown event', 'lesson_started', valid, 'unknown_event'],
    ['built-in object key', 'constructor', {}, 'unknown_event'],
    ['unknown property', 'lesson_completed', { ...valid, note: 'x' }, 'unknown_property:note'],
    ['missing required property', 'lesson_completed', { lesson_id: 'l5', result: 'passed' }, 'missing_property:mistakes'],
    ['fractional integer', 'lesson_completed', { ...valid, mistakes: 1.5 }, 'not_integer:mistakes'],
    ['below min', 'lesson_completed', { ...valid, mistakes: -1 }, 'below_min:mistakes'],
    ['string too long', 'lesson_completed', { ...valid, lesson_id: 'way-too-long' }, 'too_long:lesson_id'],
    ['value outside the enum', 'lesson_completed', { ...valid, result: 'skipped' }, 'not_allowed_value:result'],
    ['wrong type', 'lesson_completed', { ...valid, mistakes: '3' }, 'not_integer:mistakes'],
  ])('rejects %s', (_label, name, properties, reason) => {
    const check = checkEvent(plan, name, properties);

    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toBe(reason);
  });
});

describe('compatibilityErrors', () => {
  it('accepts the same plan', () => {
    expect(compatibilityErrors(plan, plan)).toEqual([]);
  });

  it('refuses a removed event and a new required property', () => {
    const next: TrackingPlan = {
      format_version: 1,
      events: {
        lesson_completed: {
          ...plan.events.lesson_completed!,
          properties: {
            ...plan.events.lesson_completed!.properties,
            hints_used: { type: 'integer', required: true },
          },
        },
      },
    };

    const errors = compatibilityErrors(plan, next);

    expect(errors).toContainEqual(expect.stringContaining('purchase_completed: removed'));
    expect(errors).toContainEqual(expect.stringContaining('hints_used: new properties'));
  });
});

describe('platform plan', () => {
  it('loads the generated standard events', () => {
    const platform = getPlatformPlan();

    expect(Object.keys(platform.events)).toContain('app_opened');
    expect(checkEvent(platform, 'app_opened', { cold_start: true }).ok).toBe(true);
  });
});