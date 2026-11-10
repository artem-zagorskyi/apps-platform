import { canonicalJson, type ConfigDocument, type Experiment } from './document.js';

// What changed between two config documents, and how to carry a draft over
// to a newer live version. Pure: no database.

export interface ConfigChange {
  // e.g. parameters.promo_banner_text.value, experiments.paywall_test.status, holdout.percent
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

const PARAMETER_PARTS = ['force', 'value', 'rules'] as const;
// Set by the server on publish: never a change made by a person
const STAMPS = new Set(['started_at', 'stopped_at']);

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function change(path: string, before: unknown, after: unknown): ConfigChange | null {
  if (same(before, after)) return null;
  if (before === undefined) return { path, kind: 'added', after };
  if (after === undefined) return { path, kind: 'removed', before };
  return { path, kind: 'changed', before, after };
}

function experimentFields(experiment: Experiment | undefined): Record<string, unknown> {
  if (!experiment) return {};
  return Object.fromEntries(Object.entries(experiment).filter(([key]) => !STAMPS.has(key)));
}

// Changes from `before` to `after`; before is null when nothing was published yet
export function diffDocuments(before: ConfigDocument | null, after: ConfigDocument): ConfigChange[] {
  const changes: (ConfigChange | null)[] = [];
  const empty: ConfigDocument = { format_version: 1, holdout: { percent: 0 }, layers: ['default'], parameters: {}, experiments: {} };
  const a = before ?? empty;

  changes.push(change('holdout.percent', a.holdout.percent, after.holdout.percent));
  changes.push(change('layers', a.layers, after.layers));

  const names = [...new Set([...Object.keys(a.parameters), ...Object.keys(after.parameters)])].sort();
  for (const name of names) {
    const from = own(a.parameters, name) ?? {};
    const to = own(after.parameters, name) ?? {};
    for (const part of PARAMETER_PARTS) {
      changes.push(change(`parameters.${name}.${part}`, from[part], to[part]));
    }
  }

  const keys = [...new Set([...Object.keys(a.experiments), ...Object.keys(after.experiments)])].sort();
  for (const key of keys) {
    const from = own(a.experiments, key);
    const to = own(after.experiments, key);
    if (!from || !to) {
      changes.push(change(`experiments.${key}`, from && experimentFields(from), to && experimentFields(to)));
      continue;
    }
    const fromFields = experimentFields(from);
    const toFields = experimentFields(to);
    for (const field of [...new Set([...Object.keys(fromFields), ...Object.keys(toFields)])].sort()) {
      changes.push(change(`experiments.${key}.${field}`, fromFields[field], toFields[field]));
    }
  }

  return changes.filter((c): c is ConfigChange => c !== null);
}

// Parts a draft is merged by: each parameter, each experiment, the holdout, the layers
type Part = { path: string; get: (d: ConfigDocument) => unknown; set: (d: ConfigDocument, value: unknown) => void };

function partsOf(...documents: (ConfigDocument | null)[]): Part[] {
  const present = documents.filter((d): d is ConfigDocument => d !== null);
  const names = new Set(present.flatMap((d) => Object.keys(d.parameters)));
  const keys = new Set(present.flatMap((d) => Object.keys(d.experiments)));
  const record = (field: 'parameters' | 'experiments', key: string): Part => ({
    path: `${field}.${key}`,
    get: (d) => own(d[field] as Record<string, unknown>, key),
    set: (d, value) => {
      const target = d[field] as Record<string, unknown>;
      if (value === undefined) delete target[key];
      else target[key] = value;
    },
  });
  return [
    { path: 'holdout', get: (d) => d.holdout, set: (d, v) => (d.holdout = v as ConfigDocument['holdout']) },
    { path: 'layers', get: (d) => d.layers, set: (d, v) => (d.layers = v as ConfigDocument['layers']) },
    ...[...names].sort().map((name) => record('parameters', name)),
    ...[...keys].sort().map((key) => record('experiments', key)),
  ];
}

// Carries a draft started on `base` over to the newer `live`: parts the draft
// changed come from the draft, everything else from live. A part changed in
// both is a conflict: the draft wins and the admin is told to look at it.
export function rebaseDocument(
  base: ConfigDocument | null,
  live: ConfigDocument | null,
  draft: ConfigDocument,
): { document: ConfigDocument; conflicts: string[] } {
  const empty: ConfigDocument = { format_version: 1, holdout: { percent: 0 }, layers: ['default'], parameters: {}, experiments: {} };
  const from = base ?? empty;
  const to = live ?? empty;
  const document: ConfigDocument = structuredClone(to);
  const conflicts: string[] = [];

  for (const part of partsOf(from, to, draft)) {
    const edited = !same(part.get(from), part.get(draft));
    if (!edited) continue;
    // Experiment stamps differ between versions without anyone editing them
    const liveMoved = !same(stripStamps(part.get(from)), stripStamps(part.get(to)));
    if (liveMoved && !same(stripStamps(part.get(to)), stripStamps(part.get(draft)))) conflicts.push(part.path);
    part.set(document, structuredClone(part.get(draft)));
  }

  return { document, conflicts };
}

function stripStamps(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !STAMPS.has(key)));
}

// A forced parameter that a running experiment sets: the experiment no longer
// decides it for anyone. Allowed (a kill switch), but worth a warning.
export function forceWarnings(document: ConfigDocument): string[] {
  const warnings: string[] = [];
  for (const [key, experiment] of Object.entries(document.experiments)) {
    if (experiment.status !== 'running') continue;
    const names = new Set(Object.values(experiment.variants).flatMap((variant) => Object.keys(variant.values)));
    for (const name of [...names].sort()) {
      if (own(document.parameters, name)?.force !== undefined) {
        warnings.push(`parameters.${name}: forced for everyone, so running experiment ${key} no longer decides it`);
      }
    }
  }
  return warnings;
}
