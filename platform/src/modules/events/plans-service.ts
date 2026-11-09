import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { config } from '../../core/config.js';
import { db, type Tx } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { compatibilityErrors, type TrackingPlan, trackingPlanSchema } from './plan.js';
import { type PlanChange, type PlanWarning, planChanges, summarizeChanges } from './plan-changes.js';
import { trackingPlans } from './schema.js';

const PLAN_CACHE_MS = 60_000;
// Versions shown in the admin panel
const HISTORY_LIMIT = 20;

// target: "event", "event.property" or a path inside the file
export interface PlanProblem {
  target: string;
  message: string;
}

export interface PlanCheck {
  // ok: can be uploaded; unchanged: same as the current version; invalid: see errors
  status: 'ok' | 'unchanged' | 'invalid';
  currentVersion: number | null;
  nextVersion: number | null;
  events: number | null;
  errors: PlanProblem[];
  warnings: PlanWarning[];
  changes: PlanChange[];
  summary: string | null;
}

export interface PlanUpload {
  status: 'created' | 'unchanged';
  version: number;
  events: number;
  summary: string | null;
}

let platformPlan: TrackingPlan | null = null;
const effectivePlans = new Map<string, { plan: TrackingPlan; loadedAt: number }>();

// Standard platform events, read once from the generated JSON.
// A broken file is a deployment error: fail loudly.
export function getPlatformPlan(): TrackingPlan {
  if (!platformPlan) {
    const raw: unknown = JSON.parse(readFileSync(config.PLATFORM_TRACKING_PLAN_PATH, 'utf8'));
    const result = trackingPlanSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`Invalid platform tracking plan: ${result.error.message}`);
    }
    platformPlan = result.data;
  }
  return platformPlan;
}

async function latestAppPlan(appId: string, executor: typeof db | Tx = db) {
  const [row] = await executor
    .select({ number: trackingPlans.number, plan: trackingPlans.plan })
    .from(trackingPlans)
    .where(eq(trackingPlans.appId, appId))
    .orderBy(desc(trackingPlans.number))
    .limit(1);
  return row ?? null;
}

// Platform events plus the app's own events, cached for a minute
export async function getEffectivePlan(appId: string): Promise<TrackingPlan> {
  const cached = effectivePlans.get(appId);
  if (cached && Date.now() - cached.loadedAt < PLAN_CACHE_MS) return cached.plan;

  const app = await latestAppPlan(appId);
  const plan: TrackingPlan = {
    format_version: 1,
    events: { ...getPlatformPlan().events, ...(app?.plan.events ?? {}) },
  };

  effectivePlans.set(appId, { plan, loadedAt: Date.now() });
  return plan;
}

// This process uses a new plan at once; others within a minute
export function forgetEffectivePlan(appId: string): void {
  effectivePlans.delete(appId);
}

export function clearPlanCache(): void {
  effectivePlans.clear();
}

// JSON with sorted keys: jsonb in Postgres does not keep the key order of a file
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// "events.lesson_completed.properties.mistakes.type" → "lesson_completed.mistakes.type"
function shortTarget(path: string): string {
  return path.replace(/^events\./, '').replace('.properties.', '.') || 'plan';
}

// A bad event or property name comes from zod as "Invalid key in record"
function issueMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_key') return `name ${issue.issues[0]?.message ?? 'not allowed'}`;
  return issue.message;
}

// compatibilityErrors writes "<path>: <message>"
function toProblem(error: string): PlanProblem {
  const at = error.indexOf(': ');
  return { target: shortTarget(error.slice(0, at)), message: error.slice(at + 2) };
}

function listProblems(problems: PlanProblem[]): string {
  return problems.map((problem) => `${problem.target}: ${problem.message}`).join('\n');
}

interface Inspection {
  plan: TrackingPlan | null;
  // Wrong format or names of standard platform events
  invalid: PlanProblem[];
  // Changes that would break app versions already installed
  breaking: PlanProblem[];
  warnings: PlanWarning[];
  changes: PlanChange[];
  unchanged: boolean;
}

// Checks a plan file against the format, the platform events and the current version
function inspectPlan(previous: TrackingPlan | null, json: unknown): Inspection {
  const parsed = trackingPlanSchema.safeParse(json);
  if (!parsed.success) {
    const invalid = parsed.error.issues.map((issue) => ({
      target: shortTarget(issue.path.map(String).join('.')),
      message: issueMessage(issue),
    }));
    return { plan: null, invalid, breaking: [], warnings: [], changes: [], unchanged: false };
  }

  const plan = parsed.data;
  const platformEvents = getPlatformPlan().events;
  const invalid = Object.keys(plan.events)
    .filter((name) => Object.hasOwn(platformEvents, name))
    .map((name) => ({ target: name, message: 'this name belongs to a standard platform event' }));
  const breaking = previous ? compatibilityErrors(previous, plan).map(toProblem) : [];
  const unchanged = previous !== null && canonicalJson(previous) === canonicalJson(plan);

  return { plan, invalid, breaking, ...planChanges(previous, plan), unchanged };
}

// What uploading this file would do. Nothing is stored.
export async function checkTrackingPlan(appId: string, json: unknown): Promise<PlanCheck> {
  const current = await latestAppPlan(appId);
  const result = inspectPlan(current?.plan ?? null, json);
  const errors = [...result.invalid, ...result.breaking];
  const status = errors.length > 0 ? 'invalid' : result.unchanged ? 'unchanged' : 'ok';
  const events = result.plan ? Object.keys(result.plan.events).length : null;

  return {
    status,
    currentVersion: current?.number ?? null,
    nextVersion: status === 'ok' ? (current?.number ?? 0) + 1 : null,
    events,
    errors,
    warnings: result.warnings,
    changes: result.changes,
    summary:
      events !== null && !result.unchanged ? summarizeChanges(result.changes, events, current === null) : null,
  };
}

// Stores the plan as the next version in the caller's transaction.
// Call forgetEffectivePlan after the commit.
export async function storeTrackingPlan(
  tx: Tx,
  appId: string,
  json: unknown,
  uploadedBy: string | null = null,
): Promise<PlanUpload> {
  // One upload per app at a time, so version numbers stay sequential.
  // Released automatically at the end of the transaction.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tracking-plan:${appId}`}, 0))`);

  const current = await latestAppPlan(appId, tx);
  const result = inspectPlan(current?.plan ?? null, json);
  if (!result.plan || result.invalid.length > 0) {
    throw new AppError(400, 'invalid_tracking_plan', `Invalid tracking plan:\n${listProblems(result.invalid)}`);
  }

  const plan = result.plan;
  const events = Object.keys(plan.events).length;
  if (current && result.unchanged) {
    return { status: 'unchanged', version: current.number, events, summary: null };
  }
  if (result.breaking.length > 0) {
    throw new AppError(409, 'incompatible_tracking_plan', `Breaking changes:\n${listProblems(result.breaking)}`);
  }

  const version = (current?.number ?? 0) + 1;
  const planHash = createHash('sha256').update(canonicalJson(plan)).digest('hex');
  await tx.insert(trackingPlans).values({ appId, number: version, plan, planHash, uploadedBy });
  return { status: 'created', version, events, summary: summarizeChanges(result.changes, events, current === null) };
}

// Stores a new version of an app's tracking plan after checking its format,
// name collisions with platform events and compatibility with the current one
export async function uploadTrackingPlan(
  appId: string,
  json: unknown,
  uploadedBy: string | null = null,
): Promise<PlanUpload> {
  const result = await db.transaction((tx) => storeTrackingPlan(tx, appId, json, uploadedBy));
  if (result.status === 'created') forgetEffectivePlan(appId);
  return result;
}

// The plan in effect, the latest versions with what each changed, and the platform events
export async function getTrackingPlanOverview(appId: string) {
  // One row more than shown: the oldest shown version is compared with the one before it
  const rows = await db
    .select({
      number: trackingPlans.number,
      plan: trackingPlans.plan,
      uploadedBy: trackingPlans.uploadedBy,
      createdAt: trackingPlans.createdAt,
    })
    .from(trackingPlans)
    .where(eq(trackingPlans.appId, appId))
    .orderBy(desc(trackingPlans.number))
    .limit(HISTORY_LIMIT + 1);

  const history = rows.slice(0, HISTORY_LIMIT).map((row, index) => {
    const previous = rows[index + 1]?.plan ?? null;
    const events = Object.keys(row.plan.events).length;
    return {
      version: row.number,
      uploadedAt: row.createdAt,
      uploadedBy: row.uploadedBy,
      events,
      summary: summarizeChanges(planChanges(previous, row.plan).changes, events, previous === null),
    };
  });

  const latest = rows[0];
  return {
    current: latest
      ? { version: latest.number, uploadedAt: latest.createdAt, uploadedBy: latest.uploadedBy, plan: latest.plan }
      : null,
    history,
    platform: getPlatformPlan(),
  };
}