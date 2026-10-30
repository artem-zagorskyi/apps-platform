import { describe, expect, it } from 'vitest';
import {
  compatibilityErrors,
  type ParameterDefinition,
  type ParameterSchema,
  parameterSchemaFormat,
  valueProblem,
} from './parameters.js';

const schema: ParameterSchema = {
  format_version: 1,
  parameters: {
    paywall_variant: { type: 'enum', values: ['classic', 'trial_first'], default: 'classic' },
    daily_goal_minutes: { type: 'integer', min: 5, max: 60, default: 10 },
    ads_enabled: { type: 'boolean', default: true },
    start_button_text: {
      type: 'string',
      max_length: 32,
      default: 'Start',
      description: 'Text of the start button',
    },
  },
};

function withParameter(parameter: unknown) {
  return parameterSchemaFormat.safeParse({ format_version: 1, parameters: { p: parameter } });
}

describe('parameterSchemaFormat', () => {
  it('accepts a valid schema', () => {
    expect(parameterSchemaFormat.safeParse(schema).success).toBe(true);
  });

  it.each([
    ['a default of the wrong type', { type: 'integer', default: 'ten' }],
    ['a default outside the range', { type: 'integer', min: 5, max: 60, default: 61 }],
    ['a default that is not one of the values', { type: 'enum', values: ['a'], default: 'b' }],
    ['a default longer than max_length', { type: 'string', max_length: 3, default: 'long' }],
    ['a fractional integer default', { type: 'integer', default: 1.5 }],
    ['an unknown key', { type: 'boolean', default: true, maxLength: 3 }],
    ['a key of another type', { type: 'boolean', default: true, values: ['a'] }],
    ['a missing default', { type: 'boolean' }],
    ['a string without max_length', { type: 'string', default: 'x' }],
    ['a string longer than the limit', { type: 'string', max_length: 5000, default: 'x' }],
  ])('rejects %s', (_, parameter) => {
    expect(withParameter(parameter).success).toBe(false);
  });

  it('rejects min greater than max', () => {
    const result = withParameter({ type: 'number', min: 2, max: 1, default: 2 });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('min is greater than max');
  });

  it('rejects names that are not snake_case', () => {
    const result = parameterSchemaFormat.safeParse({
      format_version: 1,
      parameters: { dailyGoal: { type: 'boolean', default: true } },
    });

    expect(result.success).toBe(false);
  });
});

describe('valueProblem', () => {
  const goal: ParameterDefinition = { type: 'integer', min: 5, max: 60, default: 10 };
  const variant: ParameterDefinition = { type: 'enum', values: ['classic'], default: 'classic' };
  const text: ParameterDefinition = { type: 'string', max_length: 3, default: 'ok' };

  it('accepts fitting values', () => {
    expect(valueProblem(goal, 15)).toBeNull();
    expect(valueProblem(variant, 'classic')).toBeNull();
    expect(valueProblem(text, 'abc')).toBeNull();
  });

  it('names the problem', () => {
    expect(valueProblem(goal, 15.5)).toBe('not_integer');
    expect(valueProblem(goal, '15')).toBe('not_integer');
    expect(valueProblem(goal, 61)).toBe('above_max');
    expect(valueProblem(goal, 1)).toBe('below_min');
    expect(valueProblem(variant, 'video')).toBe('not_allowed_value');
    expect(valueProblem(text, 'abcd')).toBe('too_long');
    expect(valueProblem({ type: 'boolean', default: true }, 'true')).toBe('not_boolean');
  });
});

describe('compatibilityErrors', () => {
  function changed(name: string, parameter: ParameterDefinition | null): ParameterSchema {
    const parameters = { ...schema.parameters };
    if (parameter) parameters[name] = parameter;
    else delete parameters[name];
    return { format_version: 1, parameters };
  }

  it('allows additions, new enum values, new defaults, ranges and deprecation', () => {
    const next: ParameterSchema = {
      format_version: 1,
      parameters: {
        ...schema.parameters,
        paywall_variant: {
          type: 'enum',
          values: ['classic', 'trial_first', 'video'],
          default: 'video',
          deprecated: true,
        },
        daily_goal_minutes: { type: 'integer', min: 1, max: 120, default: 20 },
        streaks_enabled: { type: 'boolean', default: false },
      },
    };

    expect(compatibilityErrors(schema, next)).toEqual([]);
  });

  it('refuses removing a parameter', () => {
    expect(compatibilityErrors(schema, changed('ads_enabled', null))).toEqual([
      'parameters.ads_enabled: removed; mark it deprecated instead',
    ]);
  });

  it('refuses changing a type', () => {
    const next = changed('daily_goal_minutes', { type: 'number', default: 10 });

    expect(compatibilityErrors(schema, next)).toEqual([
      'parameters.daily_goal_minutes.type: changed from integer to number',
    ]);
  });

  it('refuses removing enum values', () => {
    const next = changed('paywall_variant', { type: 'enum', values: ['classic'], default: 'classic' });

    expect(compatibilityErrors(schema, next)).toEqual([
      'parameters.paywall_variant.values: removed trial_first',
    ]);
  });
});