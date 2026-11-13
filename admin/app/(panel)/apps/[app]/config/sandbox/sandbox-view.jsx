'use client';

import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { conditionSummary } from '@/components/config/condition-editor';
import { SAMPLE_TRAITS, TraitInputs, TraitList } from '@/components/config/traits';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { experimentOutcome, showValue } from '@/lib/config-format';
import { cn } from '@/lib/utils';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^\d+(\.\d+){0,2}$/;
const COUNTRY = /^[A-Z]{2}$/;
const OS_VERSION = /^\d+(\.\d+){0,2}$/;
const PLATFORM_LABELS = { android: 'Android', ios: 'iOS' };

const BADGE = {
  force: 'bg-warning-soft text-warning',
  experiment: 'bg-primary-soft text-primary-soft-foreground',
  rule: 'border border-border bg-card text-foreground',
  server: 'bg-muted text-foreground',
  'built-in': 'border border-border text-muted-foreground',
};

const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', day: 'numeric', month: 'short', year: 'numeric' });

// "Linked account is yes and Country is DE, AT"
function whenText(when, fields) {
  return Object.entries(when)
    .map(([key, value]) => {
      const field = fields.find((item) => item.key === key);
      return field ? conditionSummary(field, value) : key;
    })
    .join(' and ');
}

// One row of the resolved config: value, what decided it, and why
function resolve(name, decision, { definition, document, explanation, fields }) {
  const parameter = document?.parameters?.[name];
  const skipped = (decision?.skippedRules ?? []).map(
    (rule) => `rule ${rule.index + 1} skipped: ${rule.problems.join('; ')}`,
  );
  const source = decision?.source ?? { kind: 'default' };
  const inExperiment = explanation.experiments.find((item) => item.key === source.experiment);

  // Running experiments that would set this parameter but did not take the user
  const missed =
    source.kind === 'experiment'
      ? []
      : explanation.experiments
          .filter((item) => !['assigned', 'forced', 'not_running'].includes(item.outcome))
          .filter((item) =>
            Object.values(document?.experiments?.[item.key]?.variants ?? {}).some((variant) => name in variant.values),
          )
          .map((item) => `not in ${item.key}: ${experimentOutcome(item, explanation.holdout)}`);

  switch (source.kind) {
    case 'force':
      return { value: decision.value, by: 'force', why: 'forced for everyone', notes: [] };
    case 'experiment':
      return {
        value: decision.value,
        by: 'experiment',
        why: `experiment ${source.experiment}: ${inExperiment ? experimentOutcome(inExperiment, explanation.holdout) : `variant ${source.variant}`}`,
        notes: [],
      };
    case 'rule':
      return {
        value: decision.value,
        by: 'rule',
        why: `rule ${source.index + 1}: ${whenText(parameter?.rules?.[source.index]?.when ?? {}, fields)}`,
        notes: [...missed, ...skipped],
      };
    case 'value':
      return {
        value: decision.value,
        by: 'server',
        why: skipped.length ? 'no rule matched, server value' : 'server value',
        notes: [...missed, ...skipped],
      };
    default:
      return {
        value: definition?.default,
        by: 'built-in',
        why: definition ? 'nothing set on the server, built-in value' : 'not declared in the schema, the app decides',
        notes: [...missed, ...skipped],
      };
  }
}

function installationLabel(installation) {
  const device = [installation.deviceManufacturer, installation.deviceModel].filter(Boolean).join(' ');
  return [device || installation.id.slice(0, 8), PLATFORM_LABELS[installation.platform] ?? installation.platform, installation.appVersion]
    .filter(Boolean)
    .join(' · ');
}

/**
 * overview: { live, draft, schema, conditionFields } from the admin API
 * explain(request) → { ok, data } | { error }: the server's explanation for one user
 */
export function SandboxView({ overview, explain }) {
  const { live, draft, schema, conditionFields } = overview;
  const [mode, setMode] = useState('id');
  const [userId, setUserId] = useState('');
  const [installationId, setInstallationId] = useState(null);
  const [platform, setPlatform] = useState('android');
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [country, setCountry] = useState('DE');
  const [signIn, setSignIn] = useState('anonymous');
  const [osVersion, setOsVersion] = useState('14');
  const [personalization, setPersonalization] = useState(false);
  const [traits, setTraits] = useState(SAMPLE_TRAITS);
  const [showTraits, setShowTraits] = useState(false);
  const [config, setConfig] = useState(live || !draft ? 'live' : 'draft');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const nothing = config === 'live' ? !live : !draft;

  // The request, or why it cannot be sent yet
  const request = useMemo(() => {
    if (mode === 'id') {
      const id = userId.trim();
      if (!UUID.test(id)) return { hint: id ? 'A user ID looks like 019a4c2e-…' : 'Paste a user ID' };
      return { body: { config, user: { kind: 'id', userId: id, ...(installationId ? { installationId } : {}) } } };
    }
    if (!VERSION.test(appVersion.trim())) return { hint: 'App version must look like 1.2.3' };
    const code = country.trim().toUpperCase();
    if (code && !COUNTRY.test(code)) return { hint: 'Country is a two-letter code like DE, or empty for unknown' };
    const os = osVersion.trim();
    if (os && !OS_VERSION.test(os)) return { hint: 'OS version must look like 14 or 17.2, or empty for unknown' };
    return {
      body: {
        config,
        user: {
          kind: 'manual',
          platform,
          appVersion: appVersion.trim(),
          country: code || null,
          linked: signIn !== 'anonymous',
          signIn,
          osVersion: os || null,
          traits: personalization ? traits : null,
        },
      },
    };
  }, [mode, userId, installationId, platform, appVersion, country, signIn, osVersion, personalization, traits, config]);

  const key = request.body ? JSON.stringify(request.body) : null;
  useEffect(() => {
    if (!key || nothing) return undefined;
    let current = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      const response = await explain(JSON.parse(key));
      if (!current) return;
      setLoading(false);
      if (response.error) {
        setError(response.code === 'user_not_found' ? 'No user with this ID in this app' : response.error);
        setResult(null);
      } else {
        setError(null);
        setResult(response.data);
      }
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key, nothing, explain]);

  const shown = request.body && !error && !nothing ? result : null;
  const document = config === 'live' ? live?.document : draft?.document;

  const rows = useMemo(() => {
    if (!shown) return [];
    const declared = Object.entries(schema?.parameters ?? {}).filter(([, definition]) => !definition.deprecated);
    const names = new Set([...declared.map(([name]) => name), ...shown.explanation.parameters.map((p) => p.name)]);
    return [...names].sort().map((name) => ({
      name,
      ...resolve(name, shown.explanation.parameters.find((p) => p.name === name), {
        definition: schema?.parameters?.[name],
        document,
        explanation: shown.explanation,
        fields: conditionFields.rules,
      }),
    }));
  }, [shown, schema, document, conditionFields]);

  const label = shown
    ? [
        shown.user && `${shown.user.id.slice(0, 8)}…`,
        `${PLATFORM_LABELS[shown.context.platform] ?? shown.context.platform}${shown.context.osVersion ? ` ${shown.context.osVersion}` : ''}`,
        shown.context.appVersion,
        shown.context.country ?? 'country unknown',
        shown.context.linked && 'linked',
        !shown.context.traits && 'no personalization',
        shown.config.kind === 'live' ? `v${shown.config.version}` : 'draft',
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const experiments = shown?.explanation.experiments.filter((item) => item.outcome !== 'not_running') ?? [];
  const found = shown?.user?.installations.find((item) => item.id === shown.user.installationId);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(17.5rem,21.25rem)_minmax(0,1fr)]">
      <section className="flex flex-col gap-3.5 rounded-lg border border-border bg-card px-4 py-3.5">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Who is asking</h2>
          <span className="text-xs text-muted-foreground">See exactly what config a user would get, and why</span>
        </div>
        <Segmented
          fill
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'id', label: 'By user ID' },
            { value: 'manual', label: 'Describe a user' },
          ]}
        />

        {mode === 'id' ? (
          <div className="flex flex-col gap-2.5">
            <Field label="User ID">
              <Input
                mono
                value={userId}
                spellCheck={false}
                placeholder="019a4c2e-…"
                onChange={(event) => {
                  setUserId(event.target.value);
                  setInstallationId(null);
                }}
              />
            </Field>
            {shown?.user && (
              <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                {shown.user.mergedFrom && <span>Merged into {shown.user.id}; its config is shown.</span>}
                {shown.user.installations.length > 1 ? (
                  <Select
                    label="Device"
                    value={shown.user.installationId}
                    onValueChange={setInstallationId}
                    items={shown.user.installations.map((item) => ({ value: item.id, label: installationLabel(item) }))}
                  />
                ) : (
                  found && <span>Found: {installationLabel(found)}</span>
                )}
                <span>
                  {shown.context.traits ? 'Allowed personalization' : 'No personalization consent: trait conditions never match'}
                </span>
                {shown.context.traits && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowTraits(!showTraits)}
                      className="self-start text-xs font-medium text-primary-soft-foreground hover:underline"
                    >
                      {showTraits ? 'Hide traits' : 'Show traits'}
                    </button>
                    {showTraits && (
                      <div className="rounded-md border border-border px-2.5 py-2">
                        <TraitList traits={shown.context.traits} />
                      </div>
                    )}
                  </>
                )}
                <span>
                  {[
                    shown.context.country
                      ? `last seen in ${shown.context.country}${found?.city ? `, ${found.city}` : ''} (the app is placed by its current IP)`
                      : 'country unknown',
                    shown.user.linked.length
                      ? `${shown.user.linked.map((p) => p[0].toUpperCase() + p.slice(1)).join(', ')} linked`
                      : 'no linked account',
                    `user since ${dateFormat.format(new Date(shown.user.createdAt))}`,
                  ].join(' · ')}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <Field label="Platform">
              <Segmented
                fill
                value={platform}
                onValueChange={setPlatform}
                options={Object.entries(PLATFORM_LABELS).map(([value, text]) => ({ value, label: text }))}
              />
            </Field>
            <Field label="App version">
              <Input mono value={appVersion} onChange={(event) => setAppVersion(event.target.value)} placeholder="1.4.0" />
            </Field>
            <Field label="Country" description="Two letters; empty means unknown">
              <Input
                mono
                value={country}
                maxLength={2}
                onChange={(event) => setCountry(event.target.value.toUpperCase())}
                placeholder="DE"
              />
            </Field>
            <Field label="Signed in with">
              <Segmented
                fill
                value={signIn}
                onValueChange={setSignIn}
                options={[
                  { value: 'anonymous', label: 'Anonymous' },
                  { value: 'google', label: 'Google' },
                  { value: 'apple', label: 'Apple' },
                ]}
              />
            </Field>
            <Field label="OS version" description="Empty means unknown">
              <Input mono value={osVersion} onChange={(event) => setOsVersion(event.target.value)} placeholder="14" />
            </Field>
            <label className="flex items-center justify-between text-[0.8125rem]">
              Allowed personalization
              <Switch checked={personalization} onCheckedChange={setPersonalization} />
            </label>
            {personalization ? (
              <div className="rounded-md border border-border px-2.5 py-2.5">
                <TraitInputs value={traits} onChange={setTraits} />
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Without it, conditions on activity, purchases and the device never match.</span>
            )}
            <span className="text-xs text-muted-foreground">
              Without a user ID nobody can be placed in experiments or the holdout; rules still apply.
            </span>
          </div>
        )}

        <Field label="Config">
          <Segmented
            fill
            value={config}
            onValueChange={setConfig}
            options={[
              { value: 'live', label: live ? `Live v${live.version}` : 'Live' },
              { value: 'draft', label: draft ? `Draft (${draft.changes.length})` : 'No draft' },
            ]}
          />
        </Field>
        {config === 'draft' && draft?.errors.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-destructive">
            <CircleAlert className="size-3.5" />
            The draft has {draft.errors.length} error{draft.errors.length === 1 ? '' : 's'} and would not publish
          </span>
        )}
      </section>

      <div className="flex min-w-0 flex-col gap-4">
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <h2 className="text-sm font-semibold">Resolved config</h2>
            {label && <span className="font-mono text-xs font-medium text-muted-foreground">{label}</span>}
            {loading && <LoaderCircle className="ml-auto size-3.5 animate-spin text-muted-foreground" />}
          </div>
          {nothing ? (
            <Empty>{config === 'live' ? 'Nothing is published yet.' : 'There is no draft.'}</Empty>
          ) : error ? (
            <Empty destructive>{error}</Empty>
          ) : !request.body ? (
            <Empty>{request.hint}</Empty>
          ) : !shown ? (
            <Empty>Working it out…</Empty>
          ) : rows.length === 0 ? (
            <Empty>No parameters declared yet.</Empty>
          ) : (
            <div className={cn('transition-opacity', loading && 'opacity-60')}>
              {rows.map((row) => (
                <div key={row.name} className="flex flex-col gap-1 border-t border-border px-4 py-2.5">
                  <span className="font-mono text-[0.8125rem] font-medium">
                    {row.name} <span className="text-muted-foreground">=</span>{' '}
                    <span className="text-primary-soft-foreground">{showValue(row.value)}</span>
                  </span>
                  <span className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <span className={cn('shrink-0 rounded-[0.25rem] px-[0.3125rem] py-[0.1875rem] font-mono text-[0.625rem] font-medium leading-none', BADGE[row.by])}>
                      {row.by}
                    </span>
                    <span className="text-pretty">{row.why}</span>
                  </span>
                  {row.notes.map((note) => (
                    <span key={note} className="pl-1 text-xs text-muted-foreground/80">
                      {note}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        {shown && (experiments.length > 0 || shown.explanation.holdout.percent > 0) && (
          <section className={cn('overflow-hidden rounded-lg border border-border bg-card transition-opacity', loading && 'opacity-60')}>
            <div className="px-4 py-3 text-sm font-semibold">Experiments</div>
            {shown.explanation.holdout.percent > 0 && (
              <Line name="holdout">
                {shown.explanation.holdout.bucket === null
                  ? `${shown.explanation.holdout.percent}%: needs a user ID`
                  : shown.explanation.holdout.inHoldout
                    ? `in the holdout: bucket ${shown.explanation.holdout.bucket} is below ${shown.explanation.holdout.percent}%`
                    : `not in the holdout (${shown.explanation.holdout.percent}%)`}
              </Line>
            )}
            {experiments.map((item) => (
              <Line key={item.key} name={item.key} active={item.outcome === 'assigned' || item.outcome === 'forced'}>
                {experimentOutcome(item, shown.explanation.holdout)}
                {(item.outcome === 'assigned' || item.outcome === 'forced') &&
                  (item.parameters.length
                    ? ` · sets ${item.parameters.join(', ')}`
                    : ' · every parameter it sets is forced, so the app does not hear of it')}
              </Line>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function Empty({ children, destructive }) {
  return (
    <div className={cn('border-t border-border px-4 py-5 text-[0.8125rem]', destructive ? 'text-destructive' : 'text-muted-foreground')}>
      {children}
    </div>
  );
}

function Line({ name, active, children }) {
  return (
    <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-start gap-3 border-t border-border px-4 py-2.5 text-[0.8125rem]">
      <span className={cn('truncate font-mono text-xs', active ? 'font-medium' : 'text-muted-foreground')}>{name}</span>
      <span className={cn('text-xs', active ? 'text-foreground' : 'text-muted-foreground')}>{children}</span>
    </div>
  );
}
