// Numbers on the Overview, as the design cheat sheet asks:
// thousands with a comma, percent whole from 10 %, one decimal below
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const num = (value) => (value == null ? '—' : integer.format(Math.round(value)));

// value is a fraction (0.064 → "6.4%")
export function pct(value) {
  if (value == null) return '—';
  const percent = value * 100;
  return `${percent >= 10 || percent === 0 ? Math.round(percent) : percent.toFixed(1)}%`;
}

export function money(value, currency) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

// Change against the previous period: % for counts, percentage points for rates.
// null when there is nothing to compare with.
export function change(metric, { rate = false, goodWhen = 'up' } = {}) {
  const { value, previous } = metric;
  if (value == null || previous == null) return null;
  const diff = rate ? (value - previous) * 100 : previous === 0 ? null : ((value - previous) / previous) * 100;
  if (diff == null) return null;
  const size = Math.abs(diff);
  const tone = size < 0.05 || goodWhen === 'neutral' ? 'neutral' : (diff > 0) === (goodWhen === 'up') ? 'good' : 'bad';
  return { up: diff >= 0, tone, label: rate ? `${size.toFixed(1)} pp` : `${size.toFixed(1)}%` };
}
