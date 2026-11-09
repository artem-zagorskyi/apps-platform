const TZ = "Europe/Berlin";
const nf = new Intl.NumberFormat("en-US");
export const num = (v) => (v == null ? "—" : nf.format(Math.round(v)));
export const pct = (v, d = 1) => (v == null ? "—" : `${v.toFixed(d)}%`);
export const pp = (v) => `${Math.abs(v).toFixed(1)} pp`;
export const eur = (v, d = 0) => (v == null ? "—" : "€" + new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v));
export const compact = (v) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);

export function dateTime(d) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}
export function dayLabel(d) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" }).format(new Date(d));
}
export function relative(d, now = Date.now()) {
  const s = Math.round((now - new Date(d).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return "Yesterday";
  return dayLabel(d);
}

/** Delta with direction-aware tone. goodWhen: "up" | "down" | "neutral" */
export function delta(cur, prev, goodWhen = "up") {
  if (prev == null || prev === 0 || cur == null) return null;
  const v = ((cur - prev) / Math.abs(prev)) * 100;
  const up = v >= 0;
  const tone = goodWhen === "neutral" || Math.abs(v) < 0.05 ? "neutral" : (up === (goodWhen === "up") ? "good" : "bad");
  return { value: v, label: `${Math.abs(v).toFixed(1)}%`, up, tone };
}

/** k-anonymity: merge rows with n < min into one "Other" row. */
export function mergeSmallGroups(rows, { key = "k", count = "n", min = 10, label = "Other (< 10 each)" } = {}) {
  const keep = [], small = [];
  for (const r of rows) (r[count] < min ? small : keep).push(r);
  if (small.length) keep.push({ [key]: label, [count]: small.reduce((a, r) => a + r[count], 0), merged: true });
  return keep;
}

export const shortId = (id, n = 8) => (id ? id.slice(0, n) + "…" : "—");
