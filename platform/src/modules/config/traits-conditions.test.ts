import { describe, expect, it } from 'vitest';
import { conditionProblems, describeConditionFields, type PersonalTraits, RULE_FIELDS, TARGETING_FIELDS } from './conditions.js';
import { configDocumentFormat, documentErrors } from './document.js';

const traits: PersonalTraits = {
  daysSinceInstall: 30,
  daysSinceLastVisit: 20,
  activeDays7: 1,
  activeDays28: 3,
  streakDays: 1,
  engagement: 'returning',
  subscription: 'expired',
  entitlements: [],
  hasPurchased: true,
  daysSinceSubscriptionEnded: 10,
  language: 'de',
  notificationsEnabled: false,
  lowMemoryDevice: null,
  localHour: 23,
  installSource: null,
};

const ctx = {
  appId: 'app',
  userId: '0190a1b2-0000-7000-8000-000000000001',
  platform: 'android' as const,
  appVersion: '1.2.0',
  country: 'DE',
  linked: true,
  userCreatedAt: new Date('2026-10-01T00:00:00Z'),
  osVersion: '14',
  providers: ['google'],
  traits,
};

describe('trait conditions', () => {
  it('match the traits of the person', () => {
    const winBack = {
      engagement: ['returning'],
      subscription: ['expired', 'refunded'],
      days_since_subscription_ended: { min: 7, max: 30 },
      has_purchased: true,
      languages: ['de', 'at'],
      notifications_enabled: false,
      local_hour: { min: 22, max: 6 },
      sign_in: ['google'],
      min_os_version: '13',
    };
    expect(conditionProblems(RULE_FIELDS, winBack, ctx)).toEqual([]);

    expect(
      conditionProblems(
        RULE_FIELDS,
        { engagement: ['core'], entitlements: ['premium'], active_days_7: { min: 3 }, local_hour: { min: 6, max: 12 }, max_os_version: '13' },
        ctx,
      ),
    ).toEqual([
      'OS version 14 is above 13',
      'active days of the last 7 1 is not 3 or more',
      'engagement returning is not core',
      'has none of premium',
      'local hour 23 is not 6–12',
    ]);
  });

  it('never match without personalization consent or with an unknown device field', () => {
    const noConsent = { ...ctx, traits: null };
    expect(conditionProblems(RULE_FIELDS, { engagement: ['returning'], sign_in: ['google'] }, noConsent)).toEqual([
      'no personalization consent',
    ]);
    expect(conditionProblems(RULE_FIELDS, { low_memory_device: false, install_sources: ['x'] }, ctx)).toEqual([
      'device memory unknown',
      'install source unknown',
    ]);
    // Older contexts without the new fields: anonymous, nothing known
    const { osVersion: _os, providers: _p, traits: _t, ...old } = ctx;
    expect(conditionProblems(RULE_FIELDS, { sign_in: ['anonymous'], min_os_version: '10', streak_days: { min: 1 } }, old)).toEqual([
      'OS version unknown',
      'no personalization consent',
    ]);
  });

  it('checks their format in documents', () => {
    const doc = (when: object) => ({ format_version: 1, parameters: { goal: { rules: [{ when, value: 20 }] } } });
    for (const bad of [
      { active_days_7: {} },
      { active_days_7: { min: 5, max: 2 } },
      { active_days_7: { max: 8 } },
      { engagement: ['sleepy'] },
      { languages: ['DE'] },
      { sign_in: [] },
    ]) {
      expect(configDocumentFormat.safeParse(doc(bad)).success).toBe(false);
    }
    // Hours may wrap over midnight
    expect(configDocumentFormat.safeParse(doc({ local_hour: { min: 22, max: 6 } })).success).toBe(true);
    const schema = { format_version: 1 as const, parameters: { goal: { type: 'integer' as const, default: 15 } } };
    expect(documentErrors(configDocumentFormat.parse(doc({ min_os_version: '14', max_os_version: '13' })), schema)).toEqual([
      'parameters.goal.rules.0.when: min_os_version is above max_os_version',
    ]);
  });

  it('are described for the admin editors, also for experiment targeting', () => {
    const { rules, targeting } = describeConditionFields();
    expect(rules.find((f) => f.key === 'engagement')).toEqual({
      key: 'engagement',
      label: 'Engagement',
      kind: 'choice',
      group: 'activity',
      needs: 'personalization',
      options: ['new', 'returning', 'core', 'casual'],
    });
    expect(rules.find((f) => f.key === 'local_hour')).toMatchObject({ needs: 'personalization_analytics', bounds: { min: 0, max: 23 } });
    expect(targeting.map((f) => f.key)).toContain('subscription');
    expect(Object.keys(TARGETING_FIELDS)).not.toContain('user_ids');
  });
});
