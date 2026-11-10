// How the audit log shows times, actions, objects and changes
const TZ = 'Europe/Berlin';
const fullFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const shortFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const fullTime = (value) => fullFormat.format(new Date(value));

// "12 min ago", "Yesterday", "6 Nov, 11:08"
export function relativeTime(value, now = Date.now()) {
  const seconds = Math.round((now - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 172800) return 'Yesterday';
  return shortFormat.format(new Date(value));
}

// Badge tone by the last part of the action name (app.identity_key.revoke → revoke)
const KINDS = [
  ['danger', /^(revoke|delete|remove|disable)/],
  ['force', /^force/],
  ['create', /^(create|add|publish|start|upload|new_version|enable|rotate)/],
  ['read', /^(view|export|login|logout|sign_in|recheck|test)/],
];

export function actionKind(action) {
  const last = action.split('.').at(-1) ?? '';
  return KINDS.find(([, pattern]) => pattern.test(last))?.[0] ?? 'update';
}

export const ACTION_CLASS = {
  create: 'border-transparent bg-primary-soft text-primary-soft-foreground',
  update: 'border-border text-foreground',
  danger: 'border-transparent bg-destructive-soft text-destructive',
  force: 'border-transparent bg-warning-soft text-warning',
  read: 'border-transparent bg-muted text-muted-foreground',
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// What the action was done to, readable: "config v42", "apple · ios", a key id
export function objectLabel(entry) {
  const { targetType, targetId } = entry;
  if (!targetType) return null;
  if (targetType === 'app') return entry.app?.slug ?? targetId;

  const values = isObject(entry.after) ? entry.after : isObject(entry.before) ? entry.before : {};
  if (targetType === 'oauth_client' && values.provider) return `${values.provider} · ${values.platform}`;
  const version = isObject(entry.details) ? entry.details.version : undefined;
  const type = targetType.replaceAll('_', ' ');
  if (version != null) return `${type} v${version}`;
  // Row ids mean nothing to a person: the type says more
  return targetId && !UUID.test(targetId) ? targetId : type;
}

const show = (value) => (typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value));

// Changed fields: { field, from, to }; from is null for a new field, to for a removed one
export function changedFields(entry) {
  const before = isObject(entry.before) ? entry.before : {};
  const after = isObject(entry.after) ? entry.after : {};
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return fields
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({
      field,
      from: field in before && before[field] != null ? show(before[field]) : null,
      to: field in after && after[field] != null ? show(after[field]) : null,
    }));
}

// Context that is not a change, e.g. the version and summary of an upload
export function detailFields(entry) {
  if (!isObject(entry.details)) return [];
  return Object.entries(entry.details)
    .filter(([, value]) => value != null)
    .map(([field, value]) => ({ field, value: show(value) }));
}
