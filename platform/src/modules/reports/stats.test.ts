import { describe, expect, it } from 'vitest';
import { chiSquaredSurvival, compareConversion, normalCdf, srmPValue } from './stats.js';

// Reference values from scipy (chi2.sf, norm.cdf)

describe('normalCdf', () => {
  it('matches the standard normal curve', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 6);
  });
});

describe('chiSquaredSurvival', () => {
  it.each([
    [3.841459, 1, 0.05],
    [5.991465, 2, 0.05],
    [7.814728, 3, 0.05],
    [9.487729, 4, 0.05],
    [10.827566, 1, 0.001],
    [13.815511, 2, 0.001],
    [0.5, 1, 0.4795001],
    [2, 5, 0.849145],
  ])('chi2 = %d with %d degrees of freedom', (statistic, df, expected) => {
    expect(chiSquaredSurvival(statistic, df)).toBeCloseTo(expected, 6);
  });

  it('is 1 for no deviation', () => {
    expect(chiSquaredSurvival(0, 3)).toBe(1);
  });
});

describe('srmPValue', () => {
  it('finds nothing in an exact split', () => {
    expect(srmPValue([500, 500], [50, 50])).toBe(1);
    expect(srmPValue([340, 330, 330], [34, 33, 33])).toBeCloseTo(1, 6);
  });

  it('flags a 55/45 split of a 50/50 experiment', () => {
    // chi2 = 10 with one degree of freedom
    expect(srmPValue([550, 450], [50, 50])).toBeCloseTo(0.0015654, 6);
  });

  it('is null without traffic or with one variant', () => {
    expect(srmPValue([0, 0], [50, 50])).toBeNull();
    expect(srmPValue([10], [100])).toBeNull();
  });
});

describe('compareConversion', () => {
  it('computes the lift, its interval and the chance to win', () => {
    const result = compareConversion({ users: 1000, conversions: 100 }, { users: 1000, conversions: 120 });

    expect(result?.lift).toBeCloseTo(0.2, 6);
    expect(result?.low).toBeCloseTo(-0.100735, 5);
    expect(result?.high).toBeCloseTo(0.500735, 5);
    expect(result?.chanceToWin).toBeCloseTo(0.903789, 5);
  });

  it('is null without a base to compare against', () => {
    expect(compareConversion({ users: 100, conversions: 0 }, { users: 100, conversions: 5 })).toBeNull();
    expect(compareConversion({ users: 1, conversions: 1 }, { users: 100, conversions: 5 })).toBeNull();
  });
});