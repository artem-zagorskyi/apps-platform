// Initials and a colour that tell apps apart in the switcher. Derived from the
// app itself, so nothing extra is stored and they stay the same over time.
const HUES = [150, 30, 85, 250, 330, 195, 285, 60];

export function appInitials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export function appColor(app) {
  if (app.status === 'disabled') {
    return 'oklch(0.6 0.01 260)';
  }
  let hash = 0;
  for (const char of app.slug) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `oklch(0.6 0.13 ${HUES[hash % HUES.length]})`;
}