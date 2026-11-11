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

// Why the user is or is not in an experiment, from the server's explanation
export function experimentOutcome(decision, holdout) {
  switch (decision.outcome) {
    case 'assigned':
      return `variant ${decision.variant}, bucket ${decision.bucket}`;
    case 'forced':
      return `tester, always gets variant ${decision.variant}`;
    case 'holdout':
      return `in the holdout (${holdout.percent}% of users get no experiments)`;
    case 'outside_traffic':
      return `outside its traffic: bucket ${decision.bucket} in the layer, the test uses ${decision.from}–${decision.to}%`;
    case 'not_targeted':
      return `not targeted: ${decision.problems.join('; ')}`;
    case 'needs_user_id':
      return 'placing someone in an experiment needs a user ID';
    case 'no_variant':
      return 'variant weights do not add up to 100';
    case 'not_running':
      return decision.status;
    default:
      return decision.outcome;
  }
}

// "control / trial_first · 50 / 50"
export function variantsText(experiment) {
  const variants = Object.entries(experiment.variants ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (variants.length === 0) return 'no variants yet';
  return `${variants.map(([name]) => name).join(' / ')} · ${variants.map(([, v]) => v.weight).join(' / ')}`;
}

// Share of the layer in percent, rounded to the 0.01% buckets
export function trafficShare(experiment) {
  return Math.round((experiment.traffic.to - experiment.traffic.from) * 100) / 100;
}

// Experiments that hold part of a layer: running ones and drafts waiting to start
export function layerOccupants(document, layer, except = null) {
  return Object.entries(document?.experiments ?? {})
    .filter(([key, e]) => key !== except && e.layer === layer && (e.status === 'running' || e.status === 'draft'))
    .sort(([, a], [, b]) => a.traffic.from - b.traffic.from);
}

// How far the experiment's traffic can grow without touching the next one in its layer
export function trafficLimit(document, key) {
  const experiment = document.experiments[key];
  const next = layerOccupants(document, experiment.layer, key)
    .map(([, other]) => other.traffic.from)
    .filter((from) => from >= experiment.traffic.to);
  return next.length ? Math.min(...next) : 100;
}

// Free stretches of a layer, left to right; `except` is ignored (the experiment being edited)
export function freeGaps(document, layer, except = null) {
  const gaps = [];
  let at = 0;
  for (const [, other] of layerOccupants(document, layer, except)) {
    if (other.traffic.from > at) gaps.push({ from: at, to: other.traffic.from });
    at = Math.max(at, other.traffic.to);
  }
  if (at < 100) gaps.push({ from: at, to: 100 });
  return gaps;
}

// The first free stretch of a layer that fits `share` percent, or null
export function freeRange(document, layer, share, except = null) {
  const gap = freeGaps(document, layer, except).find((item) => item.to - item.from >= share);
  return gap ? { from: gap.from, to: Math.round((gap.from + share) * 100) / 100 } : null;
}

// The biggest share a new experiment can take in the layer
export function largestFreeShare(document, layer, except = null) {
  return Math.max(0, ...freeGaps(document, layer, except).map((gap) => Math.round((gap.to - gap.from) * 100) / 100));
}

// Whole days since an ISO time, counting the first day as day 1
export function dayNumber(since, until = new Date()) {
  return Math.floor((new Date(until).getTime() - new Date(since).getTime()) / 86_400_000) + 1;
}

// Built-in metrics that need no event, as the experiment document names them
export const BUILT_IN_METRICS = [
  { value: 'retention:d1', label: 'D1 retention', description: 'came back the day after entering' },
  { value: 'retention:d7', label: 'D7 retention', description: 'came back on day 7 after entering' },
];

// "D1 retention" for built-in metrics, the event name otherwise
export function metricLabel(metric) {
  return BUILT_IN_METRICS.find((item) => item.value === metric)?.label ?? metric;
}

export function percentText(value, digits = 1) {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(digits)}%`;
}

// "+8.4%" / "−1.2%"
export function liftText(lift) {
  const text = `${(Math.abs(lift) * 100).toFixed(1)}%`;
  return lift > 0 ? `+${text}` : lift < 0 ? `−${text}` : text;
}

// Is the change clearly good, clearly bad, or not clear yet
export function verdictOf(comparison, lowerIsBetter = false) {
  if (!comparison) return 'none';
  const up = comparison.low > 0;
  const down = comparison.high < 0;
  if (!up && !down) return 'unclear';
  return up !== lowerIsBetter ? 'better' : 'worse';
}
