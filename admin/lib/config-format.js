// How the config pages show parameters, values and changes

// "integer (5–120)", "string (max 60)", "enum (3 options)"
export function typeDetail(definition) {
  if (!definition) return null;
  switch (definition.type) {
    case 'integer':
    case 'number': {
      const { min, max } = definition;
      if (min !== undefined && max !== undefined) return `${min}–${max}`;
      if (min !== undefined) return `from ${min}`;
      if (max !== undefined) return `up to ${max}`;
      return null;
    }
    case 'string':
      return `max ${definition.max_length}`;
    case 'enum':
      return `${definition.values.length} option${definition.values.length === 1 ? '' : 's'}`;
    default:
      return null;
  }
}

// Values as they would appear in JSON: strings quoted
export function showValue(value) {
  if (value === undefined) return '—';
  return JSON.stringify(value);
}

// Why a value does not fit its declaration, or null; mirrors the server's check
export function valueProblem(definition, value) {
  if (!definition) return 'not declared in the parameter schema';
  switch (definition.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number';
      if (definition.type === 'integer' && !Number.isInteger(value)) return 'must be a whole number';
      if (definition.min !== undefined && value < definition.min) return `must be at least ${definition.min}`;
      if (definition.max !== undefined && value > definition.max) return `must be at most ${definition.max}`;
      return null;
    }
    case 'string':
      if (typeof value !== 'string') return 'must be text';
      return value.length > definition.max_length ? `is ${value.length} characters, max ${definition.max_length}` : null;
    case 'enum':
      return definition.values.includes(value) ? null : `must be one of ${definition.values.join(', ')}`;
    default:
      return null;
  }
}

// Server problem codes in plain words
const CODES = {
  too_long: 'too long',
  below_min: 'below the minimum',
  above_max: 'above the maximum',
  not_integer: 'not a whole number',
  not_number: 'not a number',
  not_boolean: 'not true or false',
  not_string: 'not text',
  not_allowed_value: 'not one of the allowed values',
};

export function readableProblem(text) {
  return text.replace(/\b(too_long|below_min|above_max|not_integer|not_number|not_boolean|not_string|not_allowed_value)\b/g, (code) => CODES[code]);
}

// What gives the parameter its value now, in the order the server decides
export function decidedBy(name, config, document) {
  if (config?.force !== undefined) return { kind: 'force', label: 'force' };
  const running = Object.entries(document?.experiments ?? {}).find(
    ([, experiment]) =>
      experiment.status === 'running' && Object.values(experiment.variants).some((variant) => name in variant.values),
  );
  if (running) return { kind: 'experiment', label: 'experiment', detail: running[0] };
  const rules = config?.rules?.length ?? 0;
  if (rules > 0) return { kind: 'rule', label: 'rule', detail: `${rules} rule${rules === 1 ? '' : 's'}` };
  if (config?.value !== undefined) return { kind: 'server', label: 'server' };
  return { kind: 'built-in', label: 'built-in' };
}

// "parameters.daily_goal.force" → { group: "daily_goal", part: "force" }
export function splitChangePath(path) {
  const [head, name, ...rest] = path.split('.');
  if (head === 'parameters') return { group: name, part: rest[0] === 'value' ? 'server' : rest[0], mono: true };
  if (head === 'experiments') return { group: `experiment ${name}`, part: rest.join('.') || null, mono: true };
  if (head === 'holdout') return { group: 'holdout', part: null, mono: false };
  return { group: head, part: null, mono: false };
}
