import { describe, expect, it } from 'vitest';
import { conditionProblems, describeConditionFields, RULE_FIELDS, TARGETING_FIELDS } from './conditions.js';

const ctx = {
  appId: 'app',
  userId: '0190a1b2-0000-7000-8000-000000000001',
  platform: 'android' as const,
  appVersion: '1.2.0',
  country: 'DE',
  linked: false,
  userCreatedAt: new Date('2026-11-01T00:00:00Z'),
};

describe('condition fields', () => {
  it('reports every condition the user does not meet, in field order', () => {
    expect(
      conditionProblems(RULE_FIELDS, { platforms: ['ios'], min_app_version: '1.3', countries: ['AT'], linked: true }, ctx),
    ).toEqual([
      'platform android is not ios',
      'app version 1.2.0 is below 1.3',
      'country DE is not AT',
      'has no linked account',
    ]);
    expect(conditionProblems(RULE_FIELDS, { countries: ['DE'], max_app_version: '1.2' }, ctx)).toEqual([]);
    expect(conditionProblems(RULE_FIELDS, { countries: ['DE'] }, { ...ctx, country: null })).toEqual(['country is unknown']);
  });

  it('keeps user ids to rules', () => {
    expect(Object.keys(TARGETING_FIELDS)).not.toContain('user_ids');
    expect(conditionProblems(RULE_FIELDS, { user_ids: [ctx.userId] }, ctx)).toEqual([]);
  });

  it('describes the fields for the admin editors', () => {
    const fields = describeConditionFields();
    expect(fields.rules.map((f) => f.key)).toEqual(['platforms', 'min_app_version', 'max_app_version', 'countries', 'linked', 'user_ids']);
    expect(fields.targeting.at(-1)).toEqual({ key: 'new_users_only', label: 'New users only', kind: 'boolean' });
  });
});
