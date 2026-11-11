'use client';

import { Check, Clock, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { freeRange, largestFreeShare, showValue, valueProblem } from '@/lib/config-format';
import { cn } from '@/lib/utils';
import { ConditionEditor } from './condition-editor';
import { TesterList } from './experiment-dialogs';
import { LayerBar } from './layers-card';
import { ValueInput } from './value-input';

const STEPS = ['Variants', 'Parameters', 'Traffic', 'Targeting', 'Metrics & testers'];
const NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const NO_METRIC = '__none__';
const numberFormat = new Intl.NumberFormat('en-US');

let nextId = 0;
const variantRow = (name, weight, values = {}) => ({ id: ++nextId, name, weight: String(weight), values });

// Today's value of a parameter: what control starts with
function currentValue(document, schema, name) {
  return document.parameters[name]?.value ?? schema.parameters[name]?.default;
}

function initialState(document, key, experiment) {
  if (!experiment) {
    return {
      key: '',
      description: '',
      variants: [variantRow('control', 50), variantRow('treatment', 50)],
      parameters: [],
      layer: document.layers[0],
      share: '20',
      targeting: {},
      metric: null,
      testers: [],
    };
  }
  const variants = Object.entries(experiment.variants)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, variant]) => variantRow(name, variant.weight, { ...variant.values }));
  return {
    key,
    description: experiment.description,
    variants,
    parameters: [...new Set(variants.flatMap((variant) => Object.keys(variant.values)))].sort(),
    layer: experiment.layer,
    share: String(Math.round((experiment.traffic.to - experiment.traffic.from) * 100) / 100),
    targeting: experiment.targeting ?? {},
    metric: experiment.primary_metric ?? null,
    testers: Object.entries(experiment.forced ?? {}),
  };
}

// Problems by step. `format`: the server would refuse the document at all;
// the rest only blocks starting (the draft shows them as errors).
function problemsOf(state, { document, schema, editing, liveKeys }) {
  const variants = { format: [], other: [] };
  if (!editing) {
    if (!state.key) variants.format.push('Name the experiment');
    else if (!NAME.test(state.key)) variants.format.push('The name must be snake_case, like paywall_test');
    else if (document.experiments[state.key] || liveKeys.includes(state.key)) variants.format.push('There is an experiment with this name');
  }
  if (!state.description.trim()) variants.format.push('Describe what it tests');
  const names = state.variants.map((variant) => variant.name);
  if (names.some((name) => !NAME.test(name))) variants.format.push('Variant names must be snake_case');
  if (new Set(names).size !== names.length) variants.format.push('Two variants have the same name');
  const weights = state.variants.map((variant) => Number(variant.weight));
  if (weights.some((weight) => !Number.isInteger(weight) || weight < 1 || weight > 99)) {
    variants.format.push('Each weight is a whole number from 1 to 99');
  }
  if (state.variants.length < 2) variants.other.push('At least two variants');
  const total = weights.reduce((sum, weight) => sum + (Number.isFinite(weight) ? weight : 0), 0);
  if (total !== 100) variants.other.push(`Weights add up to ${total}%, not 100%`);

  const parameters = { format: [], other: [] };
  if (state.parameters.length === 0) parameters.other.push('Pick at least one parameter');
  if (
    state.parameters.length > 0 &&
    state.variants.length > 1 &&
    state.variants.every((variant) => state.parameters.every((name) => JSON.stringify(variant.values[name]) === JSON.stringify(state.variants[0].values[name])))
  ) {
    parameters.other.push('Every variant sets the same values: change at least one');
  }
  for (const name of state.parameters) {
    for (const variant of state.variants) {
      const problem = valueProblem(schema.parameters[name], variant.values[name]);
      if (problem) parameters.other.push(`${name} in ${variant.name}: ${problem}`);
    }
  }

  const traffic = { format: [], other: [] };
  const share = Number(state.share);
  if (!Number.isFinite(share) || share <= 0 || Math.round(share * 100) !== share * 100) {
    traffic.format.push('The share is a number above 0 with at most two decimals');
  } else if (!freeRange(document, state.layer, share, editing)) {
    traffic.format.push(`No free ${share}% in ${state.layer}`);
  }

  return [variants, parameters, traffic, { format: [], other: [] }, { format: [], other: [] }];
}

// Parameters another running experiment sets, and forced ones: both make this one pointless
function parameterWarnings(document, editing, name) {
  const warnings = [];
  if (document.parameters[name]?.force !== undefined) warnings.push('forced for everyone: the experiment would change nothing');
  for (const [key, other] of Object.entries(document.experiments)) {
    if (key === editing || other.status !== 'running') continue;
    if (Object.values(other.variants).some((variant) => name in variant.values)) {
      warnings.push(`${key} sets it already; both cannot run at once`);
    }
  }
  return warnings;
}

function build(state, document, editing, status) {
  const share = Number(state.share);
  const current = editing ? document.experiments[editing] : null;
  // Keep the place in the layer when neither the layer nor the share changed
  const traffic =
    current && current.layer === state.layer && Math.abs(current.traffic.to - current.traffic.from - share) < 1e-9
      ? current.traffic
      : freeRange(document, state.layer, share, editing);
  const variantNames = new Set(state.variants.map((variant) => variant.name));
  const forced = state.testers.filter(([, variant]) => variantNames.has(variant));

  return {
    description: state.description.trim(),
    status,
    layer: state.layer,
    traffic,
    ...(Object.keys(state.targeting).length ? { targeting: state.targeting } : {}),
    variants: Object.fromEntries(
      state.variants.map((variant) => [
        variant.name,
        {
          weight: Number(variant.weight),
          values: Object.fromEntries(
            state.parameters.filter((name) => variant.values[name] !== undefined).map((name) => [name, variant.values[name]]),
          ),
        },
      ]),
    ),
    ...(state.metric ? { primary_metric: state.metric } : {}),
    ...(forced.length ? { forced: Object.fromEntries(forced) } : {}),
  };
}

function Hint({ children, tone = 'muted' }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-xs',
        tone === 'ok' && 'font-medium text-success',
        tone === 'error' && 'text-destructive',
        tone === 'warning' && 'text-warning',
        tone === 'muted' && 'text-muted-foreground',
      )}
    >
      {tone === 'ok' && <Check className="size-3.5" strokeWidth={2.6} />}
      {tone === 'warning' && <TriangleAlert className="size-3.5" />}
      {children}
    </span>
  );
}

/**
 * Creates an experiment, or edits one that has not started.
 * editing: the key of the experiment, or null for a new one
 * events: [{ name, category }] from the tracking plan; dailyUsers: DAU or null
 * onSave(key, experiment, title) resolves to true when saved
 */
export function ExperimentWizard({ document, schema, targetingFields, liveKeys, events, dailyUsers, editing, onSave, onClose }) {
  const [state, setState] = useState(() => initialState(document, editing, editing ? document.experiments[editing] : null));
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setState((previous) => ({ ...previous, ...patch }));

  const problems = problemsOf(state, { document, schema, editing, liveKeys });
  const formatProblems = problems.flatMap((item) => item.format);
  const allProblems = problems.flatMap((item) => [...item.format, ...item.other]);
  const key = editing ?? state.key;

  const declared = Object.entries(schema.parameters ?? {})
    .filter(([name, definition]) => !definition.deprecated && !state.parameters.includes(name))
    .map(([name]) => ({ value: name, label: name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const share = Number(state.share);
  const maxShare = largestFreeShare(document, state.layer, editing);
  const range = Number.isFinite(share) && share > 0 ? freeRange(document, state.layer, share, editing) : null;
  const holdout = document.holdout?.percent ?? 0;

  async function finish(status) {
    setSaving(true);
    const saved = await onSave(
      key,
      build(state, document, editing, status),
      status === 'running' ? `${key} starts when you publish` : `${key} saved to the draft`,
    );
    setSaving(false);
    if (saved) onClose();
  }

  function setVariant(id, patch) {
    const before = state.variants.find((variant) => variant.id === id);
    const variants = state.variants.map((variant) => (variant.id === id ? { ...variant, ...patch } : variant));
    // Testers follow a renamed variant
    const testers =
      patch.name !== undefined ? state.testers.map(([user, name]) => [user, name === before.name ? patch.name : name]) : state.testers;
    set({ variants, testers });
  }

  function addParameter(name) {
    const value = currentValue(document, schema, name);
    set({
      parameters: [...state.parameters, name].sort(),
      variants: state.variants.map((variant) => ({ ...variant, values: { ...variant.values, [name]: value } })),
    });
  }

  const own = problems[step];
  const stepContent = [
    // Variants
    <div key="variants" className="flex flex-col gap-3">
      {!editing && (
        <Field label="Name" description="snake_case; the app and the results use it">
          <Input mono autoFocus value={state.key} onChange={(event) => set({ key: event.target.value.trim() })} placeholder="streak_reminder_v2" />
        </Field>
      )}
      <Field label="What it tests">
        <Input
          value={state.description}
          maxLength={200}
          onChange={(event) => set({ description: event.target.value })}
          placeholder="Evening reminder instead of the default hour"
        />
      </Field>
      <span className="text-muted-foreground">Variants and how traffic splits between them. Control keeps today's behaviour.</span>
      {state.variants.map((variant, index) => (
        <div key={variant.id} className="grid grid-cols-[minmax(0,1fr)_7rem_2rem] items-center gap-2.5">
          <Input mono value={variant.name} onChange={(event) => setVariant(variant.id, { name: event.target.value.trim() })} />
          <span className="flex items-center gap-1.5">
            <Input mono value={variant.weight} onChange={(event) => setVariant(variant.id, { weight: event.target.value })} className="text-right" />
            <span className="text-muted-foreground">%</span>
          </span>
          {index >= 2 ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${variant.name}`}
              onClick={() => set({ variants: state.variants.filter((item) => item.id !== variant.id) })}
            >
              <Trash2 />
            </Button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {state.variants.length < 5 && (
        <Button
          variant="outline"
          size="sm"
          className="self-start border-dashed"
          onClick={() => {
            const values = Object.fromEntries(state.parameters.map((name) => [name, currentValue(document, schema, name)]));
            set({ variants: [...state.variants, variantRow(`variant_${state.variants.length}`, 0, values)] });
          }}
        >
          <Plus />
          Add variant
        </Button>
      )}
    </div>,

    // Parameters
    <div key="parameters" className="flex flex-col gap-3">
      <span className="text-muted-foreground">What each variant changes. Parameters not listed keep their normal value.</span>
      {state.parameters.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <div style={{ minWidth: `${12 + state.variants.length * 10}rem` }}>
            <div
              className="grid items-center gap-2.5 bg-muted px-3 py-2 text-xs font-medium text-muted-foreground"
              style={{ gridTemplateColumns: `minmax(10rem,1fr) repeat(${state.variants.length}, minmax(8.5rem,1fr)) 2rem` }}
            >
              <span>Parameter</span>
              {state.variants.map((variant) => (
                <span key={variant.id} className="truncate font-mono">
                  {variant.name}
                </span>
              ))}
              <span />
            </div>
            {state.parameters.map((name) => {
              const definition = schema.parameters[name];
              const warnings = parameterWarnings(document, editing, name);
              return (
                <div key={name} className="border-t border-border px-3 py-2">
                  <div
                    className="grid items-center gap-2.5"
                    style={{ gridTemplateColumns: `minmax(10rem,1fr) repeat(${state.variants.length}, minmax(8.5rem,1fr)) 2rem` }}
                  >
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate font-mono text-xs font-medium">{name}</span>
                      <span className="truncate text-[0.6875rem] text-muted-foreground">
                        now {showValue(currentValue(document, schema, name))}
                      </span>
                    </span>
                    {state.variants.map((variant) => (
                      <ValueInput
                        key={variant.id}
                        definition={definition}
                        value={variant.values[name]}
                        invalid={Boolean(valueProblem(definition, variant.values[name]))}
                        onChange={(value) => setVariant(variant.id, { values: { ...variant.values, [name]: value } })}
                        className="w-full"
                      />
                    ))}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${name}`}
                      onClick={() =>
                        set({
                          parameters: state.parameters.filter((item) => item !== name),
                          variants: state.variants.map((variant) => {
                            const values = { ...variant.values };
                            delete values[name];
                            return { ...variant, values };
                          }),
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {warnings.map((warning) => (
                    <Hint key={warning} tone="warning">
                      {warning}
                    </Hint>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {declared.length > 0 ? (
        <Select label="Add" placeholder="a parameter" mono value={null} items={declared} onValueChange={addParameter} />
      ) : (
        state.parameters.length === 0 && <Hint>No parameters declared. Upload remote_config.json in App settings → Config.</Hint>
      )}
    </div>,

    // Traffic
    <div key="traffic" className="flex flex-col gap-3">
      <span className="text-muted-foreground">Pick a layer and how much of its traffic to use. The new experiment takes the first free part that fits.</span>
      <div className="flex flex-wrap gap-1.5">
        {document.layers.map((layer) => (
          <button
            key={layer}
            type="button"
            onClick={() => set({ layer })}
            className={cn(
              'h-7 rounded-md border px-2.5 font-mono text-xs font-medium',
              layer === state.layer ? 'border-transparent bg-primary-soft text-primary-soft-foreground' : 'border-border bg-card hover:bg-accent',
            )}
          >
            {layer}
          </button>
        ))}
      </div>
      <LayerBar
        document={document}
        layer={state.layer}
        except={editing}
        preview={range && { ...range, label: `${key || 'new'} · ${share}%` }}
        className="h-8"
      />
      <div className="flex items-center gap-3">
        <span className="w-28 text-xs font-medium">Share of layer</span>
        <input
          type="range"
          min={1}
          max={Math.max(1, Math.floor(maxShare))}
          step={1}
          value={Number.isFinite(share) ? Math.min(share, maxShare) : 1}
          onChange={(event) => set({ share: event.target.value })}
          disabled={maxShare < 1}
          className="flex-1 accent-[var(--primary)]"
        />
        <Input mono value={state.share} onChange={(event) => set({ share: event.target.value })} className="w-20 text-right" />
        <span className="text-muted-foreground">%</span>
      </div>
      <Hint>
        {maxShare > 0 ? `Up to ${maxShare}% of ${state.layer} is free in one piece.` : `${state.layer} is full: pick another layer or add one.`}
        {holdout > 0 && ` ${holdout}% of users are in the holdout and never enter.`}
      </Hint>
    </div>,

    // Targeting
    <div key="targeting" className="flex flex-col gap-3">
      <span className="text-muted-foreground">Who can enter. Everyone else gets the normal config. Nothing here means all users.</span>
      <div className="rounded-lg border border-border px-3 py-3">
        <ConditionEditor fields={targetingFields} condition={state.targeting} onChange={(targeting) => set({ targeting })} />
      </div>
      <Hint>Targeting and variants are fixed once the experiment starts.</Hint>
    </div>,

    // Metrics & testers
    <div key="metrics" className="flex flex-col gap-4">
      <Field label="Primary metric" description="The event the experiment is judged by; Results compares how many users of each variant did it">
        <Select
          mono
          value={state.metric ?? NO_METRIC}
          onValueChange={(value) => set({ metric: value === NO_METRIC ? null : value })}
          items={[{ value: NO_METRIC, label: 'none yet' }, ...events.map((event) => ({ value: event.name, label: event.name }))]}
          triggerClassName="self-start"
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Testers</span>
        <TesterList
          variants={state.variants.map((variant) => variant.name).filter((name) => NAME.test(name))}
          rows={state.testers}
          onChange={(testers) => set({ testers })}
        />
      </div>
      {dailyUsers !== null && range && (
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted px-3 py-3">
          <Clock className="size-4 text-primary" />
          <span>
            <b className="font-semibold tabular-nums">
              ≈ {numberFormat.format(Math.round((dailyUsers * (1 - holdout / 100) * share) / 100))} daily users
            </b>{' '}
            <span className="text-muted-foreground">
              fall into {share}% of {state.layer} (DAU {numberFormat.format(dailyUsers)}, before targeting)
            </span>
          </span>
        </div>
      )}
    </div>,
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        width={760}
        title={editing ? `Edit ${editing}` : 'New experiment'}
        footer={
          <>
            <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Back
            </Button>
            <span className="flex-1" />
            <Button variant="outline" disabled={formatProblems.length > 0 || saving} onClick={() => finish('draft')}>
              Save as draft
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(step + 1)}>Next</Button>
            ) : (
              <Button disabled={allProblems.length > 0 || saving} onClick={() => finish('running')}>
                Start experiment
              </Button>
            )}
          </>
        }
      >
        <div className="-mx-5 -mt-4 mb-4 flex gap-1 overflow-x-auto border-b border-border px-5 py-2.5">
          {STEPS.map((label, index) => {
            const done = index < step;
            const current = index === step;
            const broken = problems[index].format.length + problems[index].other.length > 0 && index < step;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setStep(index)}
                className={cn(
                  'flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full py-0 pl-1 pr-2.5 text-xs font-medium',
                  current ? 'bg-primary-soft text-primary-soft-foreground' : done ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full text-[0.6875rem] font-semibold',
                    broken ? 'bg-warning text-card' : current || done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {broken ? '!' : done ? <Check className="size-3" strokeWidth={3} /> : index + 1}
                </span>
                {label}
              </button>
            );
          })}
        </div>

        {stepContent[step]}

        {(own.format.length > 0 || own.other.length > 0) && (
          <div className="mt-4 flex flex-col gap-1">
            {own.format.map((problem) => (
              <Hint key={problem} tone="error">
                {problem}
              </Hint>
            ))}
            {own.other.map((problem) => (
              <Hint key={problem} tone="warning">
                {problem}
              </Hint>
            ))}
          </div>
        )}
        {step === 0 && own.format.length === 0 && own.other.length === 0 && <Hint tone="ok">Weights add up to 100%</Hint>}
        {step === STEPS.length - 1 && allProblems.length > 0 && (
          <div className="mt-4">
            <Hint tone="warning">
              {allProblems.length} thing{allProblems.length === 1 ? '' : 's'} to fix before it can start; it can be saved as a draft
              {formatProblems.length ? ' once the name, description, variant names and traffic are valid' : ''}.
            </Hint>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
