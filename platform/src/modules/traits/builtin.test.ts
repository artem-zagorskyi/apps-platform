import { describe, expect, it } from 'vitest';
import { computeTraits } from './builtin.js';

const NOW = new Date('2026-11-12T18:30:00Z');
const created = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000);
// UTC days before NOW: 0 is today
const days = (...ago: number[]) => ago.map((n) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10));
const device = { locale: 'de_DE', notificationsEnabled: false, ramMb: 2048, timezone: 'Europe/Berlin', installSource: 'com.android.vending' };
const base = { userCreatedAt: created(60), activeDays: [], purchases: [], device: null };

describe('built-in traits', () => {
  it('reads activity: streak, active days, days away and engagement', () => {
    const core = computeTraits({ ...base, activeDays: days(1, 2, 3, 5, 6, 8, 9, 10, 11, 12, 13, 14, 20) }, NOW);
    expect(core).toMatchObject({
      daysSinceInstall: 60,
      daysSinceLastVisit: 1,
      streakDays: 4,
      activeDays7: 6,
      activeDays28: 14,
      engagement: 'core',
    });

    // Back after three weeks away
    expect(computeTraits({ ...base, activeDays: days(21, 22) }, NOW)).toMatchObject({
      daysSinceLastVisit: 21,
      streakDays: 1,
      activeDays7: 1,
      engagement: 'returning',
    });
    // Installed today: the first visit
    expect(computeTraits({ ...base, userCreatedAt: created(0) }, NOW)).toMatchObject({
      daysSinceInstall: 0,
      daysSinceLastVisit: null,
      engagement: 'new',
    });
    expect(computeTraits({ ...base, activeDays: days(3, 9) }, NOW).engagement).toBe('casual');
  });

  it('reads purchases: subscription, entitlements and when it ended', () => {
    const premium = ['premium'];
    const active = computeTraits(
      {
        ...base,
        purchases: [
          { state: 'expired', expiresAt: created(40), entitlements: premium },
          { state: 'canceled', expiresAt: created(-5), entitlements: premium },
        ],
      },
      NOW,
    );
    expect(active).toMatchObject({ subscription: 'canceled', entitlements: ['premium'], hasPurchased: true, daysSinceSubscriptionEnded: null });

    // Canceled and past its paid period: expired 3 days ago
    const lapsed = computeTraits({ ...base, purchases: [{ state: 'canceled', expiresAt: created(3), entitlements: premium }] }, NOW);
    expect(lapsed).toMatchObject({ subscription: 'expired', entitlements: [], daysSinceSubscriptionEnded: 3 });

    expect(computeTraits(base, NOW)).toMatchObject({ subscription: 'none', hasPurchased: false, entitlements: [] });
    expect(computeTraits({ ...base, purchases: [{ state: 'refunded', expiresAt: null, entitlements: premium }] }, NOW)).toMatchObject({
      subscription: 'refunded',
      hasPurchased: false,
    });
  });

  it('reads the device, when it is known', () => {
    expect(computeTraits({ ...base, device }, NOW)).toMatchObject({
      language: 'de',
      notificationsEnabled: false,
      lowMemoryDevice: true,
      localHour: 19,
      installSource: 'com.android.vending',
    });
    expect(computeTraits({ ...base, device: { ...device, timezone: 'Mars/Base', locale: null, ramMb: null } }, NOW)).toMatchObject({
      language: null,
      lowMemoryDevice: null,
      localHour: null,
    });
  });
});
