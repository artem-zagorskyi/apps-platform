import { objectLabel } from './audit-format';

// Audit entries as short sentences for Recent changes:
// app.identity_key.revoke → "Revoked backend key" + key-2026-…
const VERBS = {
  create: 'Created',
  add: 'Added',
  update: 'Updated',
  remove: 'Removed',
  delete: 'Deleted',
  revoke: 'Revoked',
  upload: 'Uploaded',
  publish: 'Published',
  new_version: 'New version of',
  set_url: 'Set the URL of',
  remove_url: 'Removed the URL of',
  rotate_secret: 'New secret for',
  test: 'Tested',
  set: 'Set',
  login: 'Signed in',
  logout: 'Signed out',
  logout_all: 'Signed out other sessions',
  view: 'Viewed',
  export: 'Exported',
  force: 'Forced',
  start: 'Started',
  stop: 'Stopped',
};

const NOUNS = {
  identity_key: 'backend key',
  oauth_client: 'sign-in client',
  consent_policy: 'consent policy',
  tracking_plan: 'tracking plan',
  parameter_schema: 'parameter schema',
  holdout: 'holdout',
  catalog: 'catalog',
  webhook: 'webhook',
  platform: 'platform',
  config: 'config',
  experiment: 'experiment',
  parameter: 'parameter',
  user: 'user data',
  purchase: 'purchase',
  app: 'app',
};

// Section of the panel an action belongs to, for the tag on the right
const AREAS = [
  [/^app\.(identity_key|oauth_client)/, 'Sign-in'],
  [/^app\.platform/, 'Platforms'],
  [/^app\./, 'Settings'],
  [/^consent_policy/, 'Consents'],
  [/^tracking_plan/, 'Events'],
  [/^(config|parameter|holdout)/, 'Config'],
  [/^experiment/, 'Experiments'],
  [/^catalog/, 'Subscriptions'],
  [/^webhook/, 'Webhooks'],
  [/^(user|purchase)/, 'Support'],
  [/^auth/, 'Account'],
];

export function actionArea(action) {
  return AREAS.find(([pattern]) => pattern.test(action))?.[1] ?? 'Platform';
}

// { text, object }: the object is shown in mono after the text
export function actionSentence(entry) {
  const parts = entry.action.split('.');
  const verb = parts.at(-1);
  const noun = NOUNS[parts.at(-2)] ?? parts.at(-2)?.replaceAll('_', ' ') ?? '';
  const text = VERBS[verb] ?? verb.replaceAll('_', ' ');
  if (parts.length < 2 || ['login', 'logout', 'logout_all'].includes(verb)) return { text, object: null };

  const object = objectLabel(entry);
  // "Uploaded catalog" + "catalog v4" would repeat itself
  const sameAsNoun = object && object.toLowerCase().startsWith(noun.toLowerCase());
  return { text: sameAsNoun ? text : `${text} ${noun}`, object };
}
