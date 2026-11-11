// Statistics for experiment results, from summary numbers only:
// per variant the number of users and how many of them converted.
// Hand-written (no library), after Flagsmith's experimentation/stats.py.

// A 95% interval spans the mean ± 1.96 standard deviations of a normal curve
const Z_95 = 1.959963984540054;

// Complementary error function, Abramowitz & Stegun 7.1.26 (error below 1.5e-7)
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const result = poly * Math.exp(-z * z);
  return x >= 0 ? result : 2 - result;
}

// Share of a standard normal curve below z
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

// Probability that a chi-squared value at least this large happens by chance.
// Exact for integer degrees of freedom through the recurrence
// Q(a+1, y) = Q(a, y) + y^a e^-y / Γ(a+1), from Q(1/2, y) = erfc(√y) and Q(1, y) = e^-y.
export function chiSquaredSurvival(statistic: number, degreesOfFreedom: number): number {
  if (statistic <= 0) return 1;
  const y = statistic / 2;
  let a: number;
  let survival: number;
  let term: number;
  if (degreesOfFreedom % 2 === 1) {
    a = 0.5;
    survival = erfc(Math.sqrt(y));
    // y^a e^-y / Γ(a+1) for a = 1/2
    term = Math.sqrt(y) * Math.exp(-y) / (Math.sqrt(Math.PI) / 2);
  } else {
    a = 1;
    survival = Math.exp(-y);
    term = y * Math.exp(-y);
  }
  while (a + 1 <= degreesOfFreedom / 2) {
    survival += term;
    a += 1;
    term = (term * y) / (a);
  }
  return Math.min(1, survival);
}

// Sample ratio mismatch: how likely random assignment alone drifts from the
// configured split as much as observed. Null when the question is meaningless.
export function srmPValue(observed: number[], weights: number[]): number | null {
  const total = observed.reduce((sum, n) => sum + n, 0);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (observed.length < 2 || total === 0 || weights.some((w) => w <= 0)) return null;

  let statistic = 0;
  observed.forEach((count, i) => {
    const expected = ((weights.at(i) ?? 0) / totalWeight) * total;
    statistic += (count - expected) ** 2 / expected;
  });
  return chiSquaredSurvival(statistic, observed.length - 1);
}

export interface Conversion {
  // Users in the variant
  users: number;
  // Of them, converted
  conversions: number;
}

export interface Comparison {
  // Relative change against control: 0.12 = +12%
  lift: number;
  // 95% interval of the lift
  low: number;
  high: number;
  // Probability that the variant really beats control
  chanceToWin: number;
}

// Sample variance of 0/1 values from their count and sum
function variance(c: Conversion): number {
  return Math.max(0, (c.conversions - c.conversions ** 2 / c.users) / (c.users - 1));
}

// Relative lift of a variant over control with the delta method. Null without
// two users per side or with no conversions in control (no base to compare to).
export function compareConversion(control: Conversion, variant: Conversion): Comparison | null {
  if (control.users < 2 || variant.users < 2 || control.conversions === 0) return null;

  const mc = control.conversions / control.users;
  const mv = variant.conversions / variant.users;
  const lift = (mv - mc) / mc;

  // Uncertainty of a ratio of two independent means
  const v = variance(variant) / (variant.users * mc ** 2) + (mv ** 2 * variance(control)) / (control.users * mc ** 4);
  const se = Math.sqrt(v);
  if (se === 0) return { lift, low: lift, high: lift, chanceToWin: lift > 0 ? 1 : lift < 0 ? 0 : 0.5 };

  return { lift, low: lift - Z_95 * se, high: lift + Z_95 * se, chanceToWin: normalCdf(lift / se) };
}

// Power 80%: the chance to see a real effect of the planned size
const Z_80 = 0.8416212335729143;

// Users per variant needed to notice a relative change of `minLift` in a
// conversion rate, two-sided at 95% with 80% power. Null for rates of 0 or 1.
export function sampleSizePerVariant(rate: number, minLift = 0.1): number | null {
  if (!(rate > 0 && rate < 1)) return null;
  const other = Math.min(rate * (1 + minLift), 0.9999);
  const spread = rate * (1 - rate) + other * (1 - other);
  return Math.ceil(((Z_95 + Z_80) ** 2 * spread) / (other - rate) ** 2);
}
