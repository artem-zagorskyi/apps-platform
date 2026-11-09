import type { ParameterDefinition, ParameterSchema } from './parameters.js';

// Everything a new parameter schema version changes, for the people reviewing it.
// Breaking changes are refused separately by compatibilityErrors.

export type SchemaChangeKind = 'added' | 'removed' | 'deprecated' | 'changed' | 'type changed';

export interface SchemaChange {
  kind: SchemaChangeKind;
  target: string;
  detail?: string;
}

// Allowed, but app versions with the previous declaration may ignore some server values
export interface SchemaWarning {
  target: string;
  message: string;
}

const WIDENED = 'app versions with the previous declaration ignore such server values and use their built-in value';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function bound(value: number | undefined): string {
  return value === undefined ? 'none' : String(value);
}

function shown(value: unknown): string {
  return JSON.stringify(value);
}

function parameterChanges(
  name: string,
  old: ParameterDefinition,
  next: ParameterDefinition,
  changes: SchemaChange[],
  warnings: SchemaWarning[],
): void {
  if (old.type !== next.type) {
    changes.push({ kind: 'type changed', target: name, detail: `${old.type} → ${next.type}` });
    return;
  }
  if (next.deprecated && !old.deprecated) changes.push({ kind: 'deprecated', target: name });
  if (!next.deprecated && old.deprecated) changes.push({ kind: 'changed', target: name, detail: 'no longer deprecated' });
  if (next.description !== old.description) changes.push({ kind: 'changed', target: name, detail: 'description' });
  if (next.default !== old.default) {
    changes.push({ kind: 'changed', target: name, detail: `built-in: ${shown(old.default)} → ${shown(next.default)}` });
  }

  if (old.type === 'enum' && next.type === 'enum') {
    const added = next.values.filter((value) => !old.values.includes(value));
    const removed = old.values.filter((value) => !next.values.includes(value));
    if (added.length > 0) {
      changes.push({ kind: 'changed', target: name, detail: `values added: ${added.join(', ')}` });
      warnings.push({ target: name, message: `new values ${added.join(', ')}: ${WIDENED}` });
    }
    if (removed.length > 0) changes.push({ kind: 'changed', target: name, detail: `values removed: ${removed.join(', ')}` });
  }

  if ((old.type === 'integer' || old.type === 'number') && (next.type === 'integer' || next.type === 'number')) {
    if (next.min !== old.min) {
      changes.push({ kind: 'changed', target: name, detail: `min: ${bound(old.min)} → ${bound(next.min)}` });
      if (old.min !== undefined && (next.min === undefined || next.min < old.min)) {
        warnings.push({ target: name, message: `values below ${old.min}: ${WIDENED}` });
      }
    }
    if (next.max !== old.max) {
      changes.push({ kind: 'changed', target: name, detail: `max: ${bound(old.max)} → ${bound(next.max)}` });
      if (old.max !== undefined && (next.max === undefined || next.max > old.max)) {
        warnings.push({ target: name, message: `values above ${old.max}: ${WIDENED}` });
      }
    }
  }

  if (old.type === 'string' && next.type === 'string' && next.max_length !== old.max_length) {
    changes.push({ kind: 'changed', target: name, detail: `max_length: ${old.max_length} → ${next.max_length}` });
    if (next.max_length > old.max_length) {
      warnings.push({ target: name, message: `texts longer than ${old.max_length}: ${WIDENED}` });
    }
  }
}

// previous is null for the first version of an app
export function schemaChanges(
  previous: ParameterSchema | null,
  next: ParameterSchema,
): { changes: SchemaChange[]; warnings: SchemaWarning[] } {
  const changes: SchemaChange[] = [];
  const warnings: SchemaWarning[] = [];
  const before = previous?.parameters ?? {};

  for (const [name, parameter] of Object.entries(next.parameters)) {
    const old = Object.hasOwn(before, name) ? before[name] : undefined;
    if (old) {
      parameterChanges(name, old, parameter, changes, warnings);
    } else {
      changes.push({ kind: 'added', target: name, detail: `${parameter.type}, built-in ${shown(parameter.default)}` });
    }
  }
  for (const name of Object.keys(before)) {
    if (!Object.hasOwn(next.parameters, name)) changes.push({ kind: 'removed', target: name });
  }

  return { changes, warnings };
}

// One line for the version history, e.g. "2 parameters added · 1 deprecated"
export function summarizeSchemaChanges(changes: SchemaChange[], parameters: number, firstVersion: boolean): string {
  if (firstVersion) return `First version · ${plural(parameters, 'parameter', 'parameters')}`;

  const count = (kinds: SchemaChangeKind[]) => changes.filter((change) => kinds.includes(change.kind)).length;
  const parts: [number, string, string][] = [
    [count(['added']), 'parameter added', 'parameters added'],
    [count(['deprecated']), 'deprecated', 'deprecated'],
    [count(['removed']), 'removed', 'removed'],
    [count(['changed', 'type changed']), 'other change', 'other changes'],
  ];
  const text = parts.filter(([n]) => n > 0).map(([n, one, many]) => plural(n, one, many));
  return text.length > 0 ? text.join(' · ') : 'Order of values only';
}