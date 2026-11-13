import { sql } from 'drizzle-orm';
import { db } from '../../core/db.js';
import type { PersonalTraits } from '../config/conditions.js';
import { isPurposeAllowed } from '../identity/consent.js';

// Built-in traits: what the platform already knows about a person's
// behaviour, purchases and device, for personalization rules. Computed when
// the config is requested. Reads the identity and billing tables directly
// (like reports; see docs/architecture.md).

const DAY_MS = 86_400_000;
// Below this much RAM a phone counts as low-memory
const LOW_MEMORY_MB = 3072;
// Engagement levels
const NEW_USER_DAYS = 7;
const AWAY_DAYS = 14;
const CORE_ACTIVE_DAYS_28 = 12;
// Activity looked at for streaks
const HISTORY_DAYS = 400;

// Purchase states that give access now; canceled keeps access until it expires
const ACCESS_STATES = new Set(['active', 'grace_period', 'canceled']);
// Which purchase speaks for the subscription when there are several
const STATE_PRIORITY = ['active', 'grace_period', 'canceled', 'on_hold', 'paused', 'expired', 'refunded'] as const;

export interface PurchaseFacts {
  state: string;
  expiresAt: Date | null;
  entitlements: string[];
}

export interface DeviceFacts {
  locale: string | null;
  notificationsEnabled: boolean | null;
  ramMb: number | null;
  timezone: string | null;
  installSource: string | null;
}

const dayOf = (date: Date) => Math.floor(date.getTime() / DAY_MS);

// The hour on the device's clock, or null for an unknown time zone
function hourIn(timezone: string | null, now: Date): number | null {
  if (!timezone) return null;
  try {
    const hour = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(now);
    return Number(hour);
  } catch {
    return null;
  }
}

// Pure: every trait from the facts. activeDays are UTC days 'YYYY-MM-DD' of
// any installation of the person; today counts as active, the person is here.
export function computeTraits(
  facts: { userCreatedAt: Date; activeDays: string[]; purchases: PurchaseFacts[]; device: DeviceFacts | null },
  now: Date,
): PersonalTraits {
  const today = dayOf(now);
  const days = new Set(facts.activeDays.map((day) => dayOf(new Date(`${day}T00:00:00Z`))));
  days.add(today);

  const before = [...days].filter((day) => day < today);
  const previous = before.length ? Math.max(...before) : null;
  let streakDays = 0;
  while (days.has(today - streakDays)) streakDays++;
  const activeIn = (span: number) => [...days].filter((day) => day > today - span && day <= today).length;

  const daysSinceInstall = Math.max(0, today - dayOf(facts.userCreatedAt));
  const daysSinceLastVisit = previous === null ? null : today - previous;
  const activeDays28 = activeIn(28);
  const engagement =
    daysSinceInstall < NEW_USER_DAYS
      ? 'new'
      : daysSinceLastVisit !== null && daysSinceLastVisit >= AWAY_DAYS
        ? 'returning'
        : activeDays28 >= CORE_ACTIVE_DAYS_28
          ? 'core'
          : 'casual';

  // A canceled purchase past its paid period has simply expired
  const states = facts.purchases.map((p) => ({
    ...p,
    state: p.state === 'canceled' && p.expiresAt && p.expiresAt <= now ? 'expired' : p.state,
  }));
  const subscription = STATE_PRIORITY.find((state) => states.some((p) => p.state === state)) ?? 'none';
  const entitlements = [
    ...new Set(states.filter((p) => ACCESS_STATES.has(p.state)).flatMap((p) => p.entitlements)),
  ].sort();
  const ended = states.filter((p) => p.state === 'expired' && p.expiresAt).map((p) => p.expiresAt!.getTime());

  const device = facts.device;
  const language = device?.locale ? (device.locale.split(/[-_]/)[0]?.toLowerCase() ?? null) : null;

  return {
    daysSinceInstall,
    daysSinceLastVisit,
    activeDays7: activeIn(7),
    activeDays28,
    streakDays,
    engagement,
    subscription,
    entitlements,
    hasPurchased: states.some((p) => p.state !== 'refunded' && p.state !== 'pending'),
    // Only when nothing gives access any more
    daysSinceSubscriptionEnded:
      subscription === 'expired' && ended.length ? Math.max(0, today - dayOf(new Date(Math.max(...ended)))) : null,
    language: language && /^[a-z]{2}$/.test(language) ? language : null,
    notificationsEnabled: device?.notificationsEnabled ?? null,
    lowMemoryDevice: device?.ramMb === null || device?.ramMb === undefined ? null : device.ramMb < LOW_MEMORY_MB,
    localHour: hourIn(device?.timezone ?? null, now),
    installSource: device?.installSource ?? null,
  };
}

export interface TraitContext {
  // The device's OS version; always known, no consent needed
  osVersion: string | null;
  // null without personalization consent
  traits: PersonalTraits | null;
}

// The traits part of a user's evaluation context
export async function loadTraitContext(
  user: { appId: string; userId: string; installationId: string; createdAt: Date },
  now: Date = new Date(),
): Promise<TraitContext> {
  const [deviceResult, allowed] = await Promise.all([
    db.execute(sql`
      select os_version, locale, notifications_enabled, ram_mb, timezone, install_source
      from identity.installations
      where id = ${user.installationId} and app_id = ${user.appId}
    `),
    isPurposeAllowed(user.appId, user.userId, 'personalization'),
  ]);
  const row = deviceResult.rows[0] as
    | {
        os_version: string;
        locale: string | null;
        notifications_enabled: boolean | null;
        ram_mb: number | null;
        timezone: string | null;
        install_source: string | null;
      }
    | undefined;
  const osVersion = row?.os_version ?? null;
  if (!allowed) return { osVersion, traits: null };

  const since = new Date(now.getTime() - HISTORY_DAYS * DAY_MS).toISOString().slice(0, 10);
  const [activity, purchases] = await Promise.all([
    db.execute(sql`
      select distinct to_char(d.day, 'YYYY-MM-DD') as day
      from identity.activity_days d
      join identity.installations i on i.id = d.installation_id
      where d.app_id = ${user.appId} and i.user_id = ${user.userId} and d.day >= ${since}::date
    `),
    db.execute(sql`
      select p.state::text as state, p.expires_at, coalesce(pr.entitlements, '{}') as entitlements
      from billing.purchases p
      left join billing.products pr
        on pr.app_id = p.app_id and pr.store = p.store and pr.product_id = p.product_id
      where p.app_id = ${user.appId} and p.user_id = ${user.userId}
    `),
  ]);

  return {
    osVersion,
    traits: computeTraits(
      {
        userCreatedAt: user.createdAt,
        activeDays: (activity.rows as { day: string }[]).map((r) => r.day),
        purchases: (purchases.rows as { state: string; expires_at: Date | string | null; entitlements: string[] }[]).map(
          (r) => ({
            state: r.state,
            expiresAt: r.expires_at === null ? null : new Date(r.expires_at),
            entitlements: r.entitlements,
          }),
        ),
        device: row
          ? {
              locale: row.locale,
              notificationsEnabled: row.notifications_enabled,
              ramMb: row.ram_mb,
              timezone: row.timezone,
              installSource: row.install_source,
            }
          : null,
      },
      now,
    ),
  };
}
