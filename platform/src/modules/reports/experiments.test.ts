import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedApp } from '../../../test/helpers.js';
import { db, pool } from '../../core/db.js';
import type { Experiment } from '../config/document.js';
import { events } from '../events/events-table.js';
import { users } from '../identity/schema.js';
import { experimentResults } from './experiments.js';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

const experiment: Experiment = {
  description: 'Trial first vs classic paywall',
  status: 'running',
  layer: 'default',
  traffic: { from: 0, to: 100 },
  variants: {
    control: { weight: 50, values: { paywall_variant: 'classic' } },
    trial: { weight: 50, values: { paywall_variant: 'trial_first' } },
  },
  primary_metric: 'lesson_completed',
  started_at: hoursAgo(24).toISOString(),
};

let appId: string;

beforeEach(async () => {
  // events.events has no foreign key to apps: rows of earlier tests stay,
  // but belong to other app ids
  await resetDatabase();
  appId = await seedApp();
});

afterAll(async () => {
  await pool.end();
});

function event(
  userId: string,
  name: string,
  at: Date,
  properties: Record<string, unknown> = {},
  valid = true,
): typeof events.$inferInsert {
  return {
    eventId: randomUUID(),
    appId,
    userId,
    installationId: randomUUID(),
    sessionId: null,
    seq: 1,
    name,
    category: 'analytics',
    occurredAt: at,
    clientOccurredAt: at,
    receivedAt: at,
    platform: 'android',
    appVersion: '1.0.0',
    appBuild: '1',
    osVersion: '15',
    country: null,
    properties,
    valid,
    invalidReason: valid ? null : 'unknown_event',
  };
}

const exposure = (userId: string, variant: string, at = hoursAgo(10), key = 'paywall_test') =>
  event(userId, 'experiment_exposed', at, { experiment: key, variant, config_version: 1 });

// `count` people exposed to a variant; the first `converted` of them convert later
async function cohort(variant: string, count: number, converted: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => randomUUID());
  await db.insert(events).values(
    ids.flatMap((id, i) => [
      exposure(id, variant),
      ...(i < converted ? [event(id, 'lesson_completed', hoursAgo(5))] : []),
    ]),
  );
  return ids;
}

async function createUser(): Promise<string> {
  const [row] = await db.insert(users).values({ appId }).returning({ id: users.id });
  if (!row) throw new Error('User insert returned no row');
  return row.id;
}

async function merge(sourceId: string, targetId: string): Promise<void> {
  await db.update(users).set({ status: 'merged', mergedInto: targetId }).where(eq(users.id, sourceId));
}

describe('experimentResults', () => {
  it('counts each person once and only conversions after the first exposure', async () => {
    const control = await cohort('control', 10, 2);
    await cohort('trial', 10, 5);
    // The first two converted, the last one did not
    const first = control.at(0)!;
    const last = control.at(-1)!;
    await db.insert(events).values([
      // A second exposure of the same person
      exposure(first, 'control', hoursAgo(8)),
      // A conversion before the exposure does not count
      event(last, 'lesson_completed', hoursAgo(12)),
      // Not this experiment, not valid, before the start
      exposure(randomUUID(), 'trial', hoursAgo(10), 'other_test'),
      { ...exposure(randomUUID(), 'trial'), valid: false, invalidReason: 'unknown_property:x' },
      exposure(randomUUID(), 'trial', hoursAgo(30)),
    ]);

    const result = await experimentResults(appId, 'paywall_test', experiment);

    expect(result.variants.map(({ variant, users, conversions }) => ({ variant, users, conversions }))).toEqual([
      { variant: 'control', users: 10, conversions: 2 },
      { variant: 'trial', users: 10, conversions: 5 },
    ]);
    expect(result.variants[0]?.comparison).toBeNull();
    expect(result.variants[1]?.comparison?.lift).toBeCloseTo(1.5, 6);
    expect(result).toMatchObject({ control: 'control', quarantined: 0, healthy: true, warnings: [] });
  });

  it('follows merges: the anonymous exposures and the account conversion are one person', async () => {
    const account = await createUser();
    const anonymous = await createUser();
    const earlier = await createUser();
    await merge(anonymous, account);
    await merge(earlier, anonymous);
    await db.insert(events).values([
      exposure(earlier, 'trial', hoursAgo(9)),
      exposure(anonymous, 'trial', hoursAgo(8)),
      event(account, 'lesson_completed', hoursAgo(7)),
    ]);

    const result = await experimentResults(appId, 'paywall_test', experiment);

    expect(result.variants.find((v) => v.variant === 'trial')).toMatchObject({ users: 1, conversions: 1 });
  });

  it('leaves out people who saw two variants', async () => {
    const account = await createUser();
    const anonymous = await createUser();
    await merge(anonymous, account);
    await db.insert(events).values([exposure(anonymous, 'control'), exposure(account, 'trial')]);

    const result = await experimentResults(appId, 'paywall_test', experiment);

    expect(result.quarantined).toBe(1);
    expect(result.variants.every((v) => v.users === 0)).toBe(true);
  });

  it('flags a split that does not match the weights', async () => {
    // 40 against 10 in a 50/50 experiment: chi2 = 18, p ≈ 0.000022
    await cohort('control', 40, 4);
    await cohort('trial', 10, 1);

    const result = await experimentResults(appId, 'paywall_test', experiment);

    expect(result.healthy).toBe(false);
    expect(result.srm).toBeCloseTo(0.0000221, 6);
    expect(result.warnings[0]).toContain('Sample ratio mismatch');
  });

  it('gives no verdict with too little data', async () => {
    await cohort('control', 3, 1);
    await cohort('trial', 3, 2);

    const result = await experimentResults(appId, 'paywall_test', experiment);

    expect(result.healthy).toBeNull();
    expect(result.variants.every((v) => v.comparison === null)).toBe(true);
    expect(result.warnings[0]).toContain('Not enough data');
  });

  it('ignores exposures after the stop', async () => {
    await cohort('control', 8, 1);
    await db.insert(events).values(exposure(randomUUID(), 'trial', hoursAgo(1)));

    const stopped: Experiment = { ...experiment, status: 'stopped', stopped_at: hoursAgo(2).toISOString() };
    const result = await experimentResults(appId, 'paywall_test', stopped);

    expect(result.variants.find((v) => v.variant === 'trial')?.users).toBe(0);
    expect(result.until).toEqual(new Date(stopped.stopped_at!));
  });

  it('counts only exposures without a primary metric', async () => {
    await cohort('control', 8, 8);
    const withoutMetric: Experiment = { ...experiment };
    delete withoutMetric.primary_metric;

    const result = await experimentResults(appId, 'paywall_test', withoutMetric);

    expect(result.variants[0]).toMatchObject({ users: 8, conversions: null, rate: null });
    expect(result.warnings).toContain('No primary_metric: only exposures are counted');
  });

  it('refuses an experiment that never started', async () => {
    const draft: Experiment = { ...experiment, status: 'draft' };
    delete draft.started_at;

    await expect(experimentResults(appId, 'paywall_test', draft)).rejects.toMatchObject({ code: 'not_started' });
  });
});