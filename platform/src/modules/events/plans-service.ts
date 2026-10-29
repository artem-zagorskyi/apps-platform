import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { desc, eq } from 'drizzle-orm';
import { config } from '../../core/config.js';
import { db } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { compatibilityErrors, type TrackingPlan, trackingPlanSchema } from './plan.js';
import { trackingPlans } from './schema.js';

const PLAN_CACHE_MS = 60_000;

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

async function latestAppPlan(appId: string) {
  const [row] = await db
    .select({ plan: trackingPlans.plan, planHash: trackingPlans.planHash })
    .from(trackingPlans)
    .where(eq(trackingPlans.appId, appId))
    .orderBy(desc(trackingPlans.createdAt))
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

export function clearPlanCache(): void {
  effectivePlans.clear();
}

// Stores a new version of an app's tracking plan after checking its format,
// name collisions with platform events and compatibility with the current one
export async function uploadTrackingPlan(
  appId: string,
  json: unknown,
): Promise<{ status: 'created' | 'unchanged'; events: number }> {
  const parsed = trackingPlanSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppError(400, 'invalid_tracking_plan', `Invalid tracking plan: ${parsed.error.message}`);
  }
  const plan = parsed.data;

  const platformNames = new Set(Object.keys(getPlatformPlan().events));
  const collisions = Object.keys(plan.events).filter((name) => platformNames.has(name));
  if (collisions.length > 0) {
    throw new AppError(
      400,
      'invalid_tracking_plan',
      `These names belong to standard platform events: ${collisions.join(', ')}`,
    );
  }

  const planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  const current = await latestAppPlan(appId);
  const events = Object.keys(plan.events).length;

  if (current?.planHash === planHash) return { status: 'unchanged', events };

  if (current) {
    const errors = compatibilityErrors(current.plan, plan);
    if (errors.length > 0) {
      throw new AppError(409, 'incompatible_tracking_plan', `Breaking changes:\n${errors.join('\n')}`);
    }
  }

  await db.insert(trackingPlans).values({ appId, plan, planHash });
  effectivePlans.delete(appId);
  return { status: 'created', events };
}