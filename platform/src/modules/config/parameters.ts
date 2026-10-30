import { z } from 'zod';

// Parameter declarations written by the SDK generator from the app's
// remote_config.yaml (same keys as the YAML).

// Same rule as event names
const nameSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, 'must be snake_case');

// Config strings are written by developers (texts, links), not typed by people
export const MAX_STRING_LENGTH = 1024;

const common = {
  description: z.string().optional(),
  deprecated: z.boolean().optional(),
};

const parameterUnion = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('boolean'), ...common, default: z.boolean() }),
  z.strictObject({
    type: z.literal('integer'),
    ...common,
    default: z.number().int(),
    min: z.number().int().optional(),
    max: z.number().int().optional(),
  }),
  z.strictObject({
    type: z.literal('number'),
    ...common,
    default: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.strictObject({
    type: z.literal('string'),
    ...common,
    default: z.string(),
    max_length: z.number().int().min(1).max(MAX_STRING_LENGTH),
  }),
  z.strictObject({
    type: z.literal('enum'),
    ...common,
    default: nameSchema,
    values: z.array(nameSchema).min(1),
  }),
]);

export type ParameterDefinition = z.infer<typeof parameterUnion>;
export type ParameterType = ParameterDefinition['type'];

// The built-in default must itself be a valid value
const parameterDefinition = parameterUnion.superRefine((parameter, ctx) => {
  if ('min' in parameter && parameter.min !== undefined && parameter.max !== undefined) {
    if (parameter.min > parameter.max) {
      ctx.addIssue({ code: 'custom', path: ['min'], message: 'min is greater than max' });
    }
  }
  const problem = valueProblem(parameter, parameter.default);
  if (problem) ctx.addIssue({ code: 'custom', path: ['default'], message: `invalid default: ${problem}` });
});

export const parameterSchemaFormat = z.strictObject({
  format_version: z.literal(1),
  parameters: z.record(nameSchema, parameterDefinition),
});

export type ParameterSchema = z.infer<typeof parameterSchemaFormat>;

function rangeProblem(p: { min?: number; max?: number }, value: number): string | null {
  if (p.min !== undefined && value < p.min) return 'below_min';
  if (p.max !== undefined && value > p.max) return 'above_max';
  return null;
}

// Why a value does not fit a parameter, or null if it does.
// Used for defaults here and for published config values.
export function valueProblem(parameter: ParameterDefinition, value: unknown): string | null {
  switch (parameter.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'not_boolean';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
        ? rangeProblem(parameter, value)
        : 'not_integer';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? rangeProblem(parameter, value)
        : 'not_number';
    case 'string':
      if (typeof value !== 'string') return 'not_string';
      return value.length > parameter.max_length ? 'too_long' : null;
    case 'enum':
      return typeof value === 'string' && parameter.values.includes(value)
        ? null
        : 'not_allowed_value';
  }
}

// Own keys only: a name like "constructor" must not find Object.prototype
export function lookupParameter(
  schema: ParameterSchema,
  name: string,
): ParameterDefinition | undefined {
  return Object.hasOwn(schema.parameters, name) ? schema.parameters[name] : undefined;
}

// Changes that would break app versions already installed on devices.
// Ranges and lengths may change: the SDK falls back to the built-in value
// when a server value does not fit its own declaration.
export function compatibilityErrors(previous: ParameterSchema, next: ParameterSchema): string[] {
  const errors: string[] = [];

  for (const [name, old] of Object.entries(previous.parameters)) {
    const path = `parameters.${name}`;
    const current = lookupParameter(next, name);
    if (!current) {
      errors.push(`${path}: removed; mark it deprecated instead`);
      continue;
    }
    if (current.type !== old.type) {
      errors.push(`${path}.type: changed from ${old.type} to ${current.type}`);
      continue;
    }
    if (old.type === 'enum' && current.type === 'enum') {
      const removed = old.values.filter((v) => !current.values.includes(v));
      if (removed.length > 0) errors.push(`${path}.values: removed ${removed.join(', ')}`);
    }
  }

  return errors;
}