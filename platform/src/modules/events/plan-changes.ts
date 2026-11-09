import type { EventDefinition, PropertyDefinition, TrackingPlan } from './plan.js';

// Everything a new tracking plan version changes, for the people reviewing it.
// Breaking changes are refused separately by compatibilityErrors.

export type PlanChangeKind = 'added' | 'removed' | 'deprecated' | 'changed' | 'type changed';

// target: "event" or "event.property"
export interface PlanChange {
  kind: PlanChangeKind;
  target: string;
  detail?: string;
}

// Allowed, but installed app versions may send data the new version rejects
export interface PlanWarning {
  target: string;
  message: string;
}

const NARROWED = 'older app versions may send values the new version rejects';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function bound(value: number | undefined): string {
  return value === undefined ? 'none' : String(value);
}

function propertyChanges(
  target: string,
  old: PropertyDefinition,
  next: PropertyDefinition,
  changes: PlanChange[],
  warnings: PlanWarning[],
): void {
  if (old.type !== next.type) {
    changes.push({ kind: 'type changed', target, detail: `${old.type} → ${next.type}` });
    return;
  }
  if (next.deprecated && !old.deprecated) changes.push({ kind: 'deprecated', target });
  if (!next.deprecated && old.deprecated) changes.push({ kind: 'changed', target, detail: 'no longer deprecated' });
  if (next.required !== old.required) {
    changes.push({ kind: 'changed', target, detail: next.required ? 'now required' : 'now optional' });
  }
  if (next.description !== old.description) changes.push({ kind: 'changed', target, detail: 'description' });

  if (old.type === 'enum' && next.type === 'enum') {
    const added = next.values.filter((value) => !old.values.includes(value));
    const removed = old.values.filter((value) => !next.values.includes(value));
    if (added.length > 0) changes.push({ kind: 'changed', target, detail: `values added: ${added.join(', ')}` });
    if (removed.length > 0) changes.push({ kind: 'changed', target, detail: `values removed: ${removed.join(', ')}` });
  }

  if ((old.type === 'integer' || old.type === 'number') && (next.type === 'integer' || next.type === 'number')) {
    if (next.min !== old.min) {
      changes.push({ kind: 'changed', target, detail: `min: ${bound(old.min)} → ${bound(next.min)}` });
      if (next.min !== undefined && (old.min === undefined || next.min > old.min)) {
        warnings.push({ target, message: `min raised to ${next.min}; ${NARROWED}` });
      }
    }
    if (next.max !== old.max) {
      changes.push({ kind: 'changed', target, detail: `max: ${bound(old.max)} → ${bound(next.max)}` });
      if (next.max !== undefined && (old.max === undefined || next.max < old.max)) {
        warnings.push({ target, message: `max lowered to ${next.max}; ${NARROWED}` });
      }
    }
  }

  if (old.type === 'string' && next.type === 'string' && next.max_length !== old.max_length) {
    changes.push({ kind: 'changed', target, detail: `max_length: ${old.max_length} → ${next.max_length}` });
    if (next.max_length < old.max_length) {
      warnings.push({ target, message: `max_length lowered to ${next.max_length}; ${NARROWED}` });
    }
  }
}

function eventChanges(
  name: string,
  old: EventDefinition,
  next: EventDefinition,
  changes: PlanChange[],
  warnings: PlanWarning[],
): void {
  if (next.deprecated && !old.deprecated) changes.push({ kind: 'deprecated', target: name });
  if (!next.deprecated && old.deprecated) changes.push({ kind: 'changed', target: name, detail: 'no longer deprecated' });
  if (next.category !== old.category) {
    changes.push({ kind: 'changed', target: name, detail: `category: ${old.category} → ${next.category}` });
  }
  if (next.description !== old.description) changes.push({ kind: 'changed', target: name, detail: 'description' });

  for (const [propertyName, property] of Object.entries(next.properties)) {
    const target = `${name}.${propertyName}`;
    const oldProperty = Object.hasOwn(old.properties, propertyName) ? old.properties[propertyName] : undefined;
    if (oldProperty) {
      propertyChanges(target, oldProperty, property, changes, warnings);
    } else {
      changes.push({ kind: 'added', target, detail: `${property.type}, ${property.required ? 'required' : 'optional'}` });
    }
  }
  for (const propertyName of Object.keys(old.properties)) {
    if (!Object.hasOwn(next.properties, propertyName)) changes.push({ kind: 'removed', target: `${name}.${propertyName}` });
  }
}

// previous is null for the first version of an app
export function planChanges(
  previous: TrackingPlan | null,
  next: TrackingPlan,
): { changes: PlanChange[]; warnings: PlanWarning[] } {
  const changes: PlanChange[] = [];
  const warnings: PlanWarning[] = [];
  const before = previous?.events ?? {};

  for (const [name, event] of Object.entries(next.events)) {
    const old = Object.hasOwn(before, name) ? before[name] : undefined;
    if (old) {
      eventChanges(name, old, event, changes, warnings);
    } else {
      const properties = plural(Object.keys(event.properties).length, 'property', 'properties');
      changes.push({ kind: 'added', target: name, detail: `${event.category}, ${properties}` });
    }
  }
  for (const name of Object.keys(before)) {
    if (!Object.hasOwn(next.events, name)) changes.push({ kind: 'removed', target: name });
  }

  return { changes, warnings };
}

// One line for the version history, e.g. "2 events added · 1 deprecated"
export function summarizeChanges(changes: PlanChange[], events: number, firstVersion: boolean): string {
  if (firstVersion) return `First version · ${plural(events, 'event', 'events')}`;

  const count = (test: (change: PlanChange) => boolean) => changes.filter(test).length;
  const isEvent = (change: PlanChange) => !change.target.includes('.');
  const parts: [number, string, string][] = [
    [count((c) => c.kind === 'added' && isEvent(c)), 'event added', 'events added'],
    [count((c) => c.kind === 'added' && !isEvent(c)), 'property added', 'properties added'],
    [count((c) => c.kind === 'deprecated'), 'deprecated', 'deprecated'],
    [count((c) => c.kind === 'removed'), 'removed', 'removed'],
    [count((c) => c.kind === 'changed' || c.kind === 'type changed'), 'other change', 'other changes'],
  ];
  const text = parts.filter(([n]) => n > 0).map(([n, one, many]) => plural(n, one, many));
  return text.length > 0 ? text.join(' · ') : 'Order of values only';
}