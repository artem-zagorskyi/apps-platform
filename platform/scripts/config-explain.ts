import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../src/core/db.js';
import { apps, type Platform } from '../src/modules/apps/schema.js';
import {
  type ConfigDocument,
  configDocumentFormat,
  documentErrors,
  lifecycleErrors,
  stampLifecycle,
} from '../src/modules/config/document.js';
import {
  type EvaluationContext,
  type ExperimentDecision,
  explainConfig,
  type ParameterDecision,
} from '../src/modules/config/evaluate.js';
import { getParameterSchema } from '../src/modules/config/schemas-service.js';
import { resolveAccount } from '../src/modules/identity/accounts.js';

// Shows which config values a user gets and why.
// Usage: pnpm -s config:explain <app slug> <user id> [--file draft.json]
//          [--platform android|ios] [--app-version 1.2.0] [--country DE] [--json]
// --file explains a draft as it would be published, without publishing it.
// The context comes from the user's last installation; flags override it.

const flags = new Map<string, string>();
const positional: string[] = [];
const args = process.argv.slice(2);
while (args.length > 0) {
  const arg = args.shift() ?? '';
  if (arg === '--json') flags.set('json', 'true');
  else if (arg.startsWith('--')) flags.set(arg.slice(2), args.shift() ?? '');
  else positional.push(arg);
}
const [slug, userId] = positional;

const pct = (b: number) => `${(b / 100).toFixed(2)}%`;
const show = (value: unknown) => (value === undefined ? '—' : JSON.stringify(value));

function table(rows: string[][]): string {
  const widths = rows[0]?.map((_, col) => Math.max(...rows.map((row) => row.at(col)?.length ?? 0))) ?? [];
  return rows.map((row) => row.map((cell, col) => cell.padEnd(widths.at(col) ?? 0)).join('   ').trimEnd()).join('\n');
}

function experimentText(d: ExperimentDecision): string {
  const silent = ', but every parameter it sets is forced: the app does not hear of it';
  switch (d.outcome) {
    case 'not_running':
      return d.status;
    case 'holdout':
      return 'not in: the user is in the holdout';
    case 'outside_traffic':
      return `not in: layer bucket ${pct(d.bucket)}, outside the traffic ${d.from}%–${d.to}%`;
    case 'not_targeted':
      return `not in: ${d.problems.join('; ')}`;
    case 'no_variant':
      return 'not in: the variant weights do not add up to 100';
    case 'assigned':
      return `${d.variant} (variant bucket ${pct(d.bucket)})${d.parameters.length === 0 ? silent : ''}`;
    case 'forced':
      return `${d.variant} (tester)${d.parameters.length === 0 ? silent : ''}`;
    case 'needs_user_id':
      return `${d.key}: needs a user ID to place the user`;
  }
}

function sourceText(p: ParameterDecision): string {
  const s = p.source;
  const base =
    s.kind === 'force'
      ? 'force'
      : s.kind === 'experiment'
        ? `experiment ${s.experiment}, variant ${s.variant}`
        : s.kind === 'rule'
          ? `rule ${s.index + 1}`
          : s.kind === 'value'
            ? 'server value'
            : 'built-in default';
  const skipped = p.skippedRules.map((r) => `rule ${r.index + 1}: ${r.problems.join(', ')}`);
  return skipped.length > 0 ? `${base} (skipped ${skipped.join('; ')})` : base;
}

async function activeVersion(appId: string): Promise<{ number: number; document: ConfigDocument } | null> {
  const result = await db.execute(sql`
    select number, document from config.versions
    where app_id = ${appId}
    order by number desc
    limit 1
  `);
  const row = result.rows[0] as { number: number; document: unknown } | undefined;
  return row ? { number: row.number, document: configDocumentFormat.parse(row.document) } : null;
}

async function main(appId: string, requestedUser: string): Promise<void> {
  const account = await resolveAccount(appId, requestedUser);
  if (!account) {
    console.error(`Unknown user ${requestedUser} in this app`);
    process.exitCode = 1;
    return;
  }

  const result = await db.execute(sql`
    select u.created_at, i.platform, i.app_version, i.country
    from identity.users u
    left join lateral (
      select platform, app_version, country
      from identity.installations
      where user_id = u.id
      order by last_seen_at desc nulls last
      limit 1
    ) i on true
    where u.id = ${account.userId}
  `);
  const row = result.rows[0] as
    | { created_at: Date; platform: Platform | null; app_version: string | null; country: string | null }
    | undefined;
  if (!row) throw new Error(`User ${account.userId} disappeared`);

  const platform = flags.get('platform') ?? row.platform ?? 'android';
  if (platform !== 'android' && platform !== 'ios') {
    console.error('--platform must be android or ios');
    process.exitCode = 1;
    return;
  }
  const ctx: EvaluationContext = {
    appId,
    userId: account.userId,
    platform,
    appVersion: flags.get('app-version') ?? row.app_version ?? '0',
    country: flags.get('country') ?? row.country ?? null,
    linked: account.linked,
    userCreatedAt: new Date(row.created_at),
  };

  const schema = await getParameterSchema(appId);
  const active = await activeVersion(appId);
  let target = active;
  let label = active ? `version ${active.number}` : 'nothing published';

  const file = flags.get('file');
  if (file) {
    const parsed = configDocumentFormat.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) {
      console.error(`The draft is not a valid config document: ${parsed.error.message}`);
      process.exitCode = 1;
      return;
    }
    const previous = active?.document ?? null;
    const errors = [...documentErrors(parsed.data, schema), ...lifecycleErrors(previous, parsed.data)];
    if (errors.length > 0) {
      console.error(`Publishing this draft would be refused:\n${errors.join('\n')}`);
      process.exitCode = 1;
      return;
    }
    const number = (active?.number ?? 0) + 1;
    target = { number, document: stampLifecycle(previous, parsed.data, new Date()) };
    label = `draft ${file}, would be version ${number}`;
  }

  const explanation = explainConfig(target, ctx);

  // Declared parameters the document never mentions use their built-in default
  const declared = schema?.parameters ?? {};
  const mentioned = new Set(explanation.parameters.map((p) => p.name));
  const parameters: ParameterDecision[] = [
    ...explanation.parameters,
    ...Object.keys(declared)
      .filter((name) => !mentioned.has(name))
      .map((name): ParameterDecision => ({ name, value: undefined, source: { kind: 'default' }, skippedRules: [] })),
  ].sort((a, b) => (a.name < b.name ? -1 : 1));

  if (flags.has('json')) {
    console.log(JSON.stringify({ context: ctx, explanation: { ...explanation, parameters } }, null, 2));
    return;
  }

  if (account.userId !== requestedUser) {
    console.log(`${requestedUser} was merged into ${account.userId}; explaining for the account\n`);
  }
  if (account.status !== 'active') {
    console.log(`! The user is ${account.status}: the server answers 401 to its requests\n`);
  }
  console.log(`Config: ${label}`);
  console.log(
    `User ${ctx.userId}: ${ctx.platform} ${ctx.appVersion}, country ${ctx.country ?? 'unknown'}, ` +
      `${ctx.linked ? 'linked account' : 'anonymous'}, created ${ctx.userCreatedAt.toISOString().slice(0, 10)}`,
  );

  const h = explanation.holdout;
  console.log(
    h.percent === 0
      ? 'Holdout: off\n'
      : `Holdout ${h.percent}%: ${h.inHoldout ? 'IN THE HOLDOUT, no experiments' : 'not in'} (bucket ${pct(h.bucket ?? 0)})\n`,
  );

  if (explanation.experiments.length > 0) {
    console.log(table([['Experiment', 'Decision'], ...explanation.experiments.map((d) => [d.key, experimentText(d)])]));
    console.log();
  }

  console.log(
    table([
      ['Parameter', 'Value', 'Decided by'],
      ...parameters.map((p) => {
        const builtIn = p.source.kind === 'default' ? declared[p.name]?.default : undefined;
        return [p.name, show(p.value ?? builtIn), sourceText(p)];
      }),
    ]),
  );
  console.log('\nThe phone uses its own built-in default for a value that does not fit its app version.');
}

if (!slug || !userId) {
  console.error(
    'Usage: pnpm -s config:explain <app slug> <user id> [--file draft.json] ' +
      '[--platform android|ios] [--app-version 1.2.0] [--country DE] [--json]',
  );
  process.exitCode = 1;
} else {
  const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, slug));
  if (!app) {
    console.error(`Unknown app "${slug}"`);
    process.exitCode = 1;
  } else {
    await main(app.id, userId);
  }
}

await pool.end();