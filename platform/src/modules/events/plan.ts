import { z } from 'zod';

// The normalized tracking plan written by the SDK generator
// (same keys as the YAML plan).

const nameSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, 'must be snake_case');

const common = {
  required: z.boolean(),
  deprecated: z.boolean().optional(),
  description: z.string().optional(),
};

const propertySchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('boolean'), ...common }),
  z.strictObject({
    type: z.literal('integer'),
    ...common,
    min: z.number().int().optional(),
    max: z.number().int().optional(),
  }),
  z.strictObject({
    type: z.literal('number'),
    ...common,
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.strictObject({
    type: z.literal('string'),
    ...common,
    max_length: z.number().int().min(1).max(128),
  }),
  z.strictObject({
    type: z.literal('enum'),
    ...common,
    values: z.array(nameSchema).min(1),
  }),
]);

const eventSchema = z.strictObject({
  category: z.enum(['essential', 'analytics']),
  description: z.string(),
  deprecated: z.boolean().optional(),
  properties: z.record(nameSchema, propertySchema),
});

export const trackingPlanSchema = z.strictObject({
  format_version: z.literal(1),
  events: z.record(nameSchema, eventSchema),
});

export type TrackingPlan = z.infer<typeof trackingPlanSchema>;
export type EventDefinition = z.infer<typeof eventSchema>;
export type PropertyDefinition = z.infer<typeof propertySchema>;
export type EventCategory = EventDefinition['category'];

export type EventCheck =
  | { ok: true; category: EventCategory }
  // category is null when the event itself is unknown
  | { ok: false; reason: string; category: EventCategory | null };

// Own keys only: a name like "constructor" must not find Object.prototype
function lookup<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function checkRange(p: { min?: number; max?: number }, value: number): string | null {
  if (p.min !== undefined && value < p.min) return 'below_min';
  if (p.max !== undefined && value > p.max) return 'above_max';
  return null;
}

function checkValue(property: PropertyDefinition, value: unknown): string | null {
  switch (property.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'not_boolean';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
        ? checkRange(property, value)
        : 'not_integer';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? checkRange(property, value)
        : 'not_number';
    case 'string':
      if (typeof value !== 'string') return 'not_string';
      return value.length > property.max_length ? 'too_long' : null;
    case 'enum':
      return typeof value === 'string' && property.values.includes(value)
        ? null
        : 'not_allowed_value';
  }
}

// Checks one event against the plan. The category comes from the plan,
// never from the client.
export function checkEvent(
  plan: TrackingPlan,
  name: string,
  properties: Record<string, unknown>,
): EventCheck {
  const event = lookup(plan.events, name);
  if (!event) return { ok: false, reason: 'unknown_event', category: null };

  const fail = (reason: string): EventCheck => ({ ok: false, reason, category: event.category });

  for (const [key, value] of Object.entries(properties)) {
    const property = lookup(event.properties, key);
    if (!property) return fail(`unknown_property:${key}`);
    const problem = checkValue(property, value);
    if (problem) return fail(`${problem}:${key}`);
  }

  for (const [key, property] of Object.entries(event.properties)) {
    // Deprecated properties are no longer sent by newer app versions
    if (property.required && !property.deprecated && !Object.hasOwn(properties, key)) {
      return fail(`missing_property:${key}`);
    }
  }

  return { ok: true, category: event.category };
}

// Changes that would break app versions already installed on devices.
// Same rules as the SDK generator.
export function compatibilityErrors(previous: TrackingPlan, next: TrackingPlan): string[] {
  const errors: string[] = [];

  for (const [name, old] of Object.entries(previous.events)) {
    const path = `events.${name}`;
    const current = lookup(next.events, name);
    if (!current) {
      errors.push(`${path}: removed; mark it deprecated instead`);
      continue;
    }
    if (current.category !== old.category) {
      errors.push(`${path}.category: changed from ${old.category} to ${current.category}`);
    }

    for (const [propertyName, oldProperty] of Object.entries(old.properties)) {
      const propertyPath = `${path}.properties.${propertyName}`;
      const property = lookup(current.properties, propertyName);
      if (!property) {
        errors.push(`${propertyPath}: removed; mark it deprecated instead`);
        continue;
      }
      if (property.type !== oldProperty.type) {
        errors.push(`${propertyPath}.type: changed from ${oldProperty.type} to ${property.type}`);
      }
      if (property.required && !oldProperty.required) {
        errors.push(`${propertyPath}: became required; older app versions do not send it`);
      }
      if (oldProperty.type === 'enum' && property.type === 'enum') {
        const removed = oldProperty.values.filter((v) => !property.values.includes(v));
        if (removed.length > 0) errors.push(`${propertyPath}.values: removed ${removed.join(', ')}`);
      }
    }

    for (const [propertyName, property] of Object.entries(current.properties)) {
      if (!Object.hasOwn(old.properties, propertyName) && property.required) {
        errors.push(`${path}.properties.${propertyName}: new properties of an existing event must be optional`);
      }
    }
  }

  return errors;
}