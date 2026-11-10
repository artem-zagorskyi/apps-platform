'use client';

import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, SheetContent } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { showValue, typeDetail, valueProblem } from '@/lib/config-format';
import { cn } from '@/lib/utils';
import { ConditionEditor } from './condition-editor';
import { ValueInput } from './value-input';

// Problems of the edited parameter config; empty when it can be saved
function problemsOf(definition, config) {
  const problems = {};
  if (config.value !== undefined) {
    const problem = valueProblem(definition, config.value);
    if (problem) problems.value = problem;
  }
  if (config.force !== undefined) {
    const problem = valueProblem(definition, config.force);
    if (problem) problems.force = problem;
  }
  (config.rules ?? []).forEach((rule, index) => {
    if (Object.keys(rule.when).length === 0) problems[`rule${index}`] = 'add at least one condition';
    else {
      const problem = valueProblem(definition, rule.value);
      if (problem) problems[`rule${index}`] = `value ${problem}`;
    }
  });
  return problems;
}

// Drops empty parts, so an untouched parameter leaves the document
function tidy(config) {
  const next = {};
  if (config.value !== undefined) next.value = config.value;
  if (config.force !== undefined) next.force = config.force;
  if (config.rules?.length) next.rules = config.rules;
  return next;
}

function RuleCard({ index, rule, definition, fields, problem, disabled, onChange, onRemove, onMove }) {
  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const from = Number(event.dataTransfer.getData('text/plain'));
        if (!Number.isNaN(from)) onMove(from, index);
      }}
      className={cn('flex gap-2 rounded-lg border bg-card px-2.5 py-2.5', problem ? 'border-destructive' : 'border-border')}
    >
      <span
        draggable={!disabled}
        onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
        title="Drag to reorder"
        className={cn('mt-0.5 text-muted-foreground', !disabled && 'cursor-grab')}
      >
        <GripVertical className="size-4" />
      </span>
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[0.6875rem] font-semibold tabular-nums">
        {index + 1}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-[0.8125rem]">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-muted-foreground">If</span>
          <ConditionEditor fields={fields} condition={rule.when} disabled={disabled} onChange={(when) => onChange({ ...rule, when })} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">then</span>
          <ValueInput definition={definition} value={rule.value} disabled={disabled} invalid={Boolean(problem)} onChange={(value) => onChange({ ...rule, value })} />
        </div>
        {problem && <span className="text-xs text-destructive">{problem}</span>}
      </div>
      {!disabled && (
        <Button variant="ghost" size="icon-sm" aria-label={`Remove rule ${index + 1}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      )}
    </div>
  );
}

/**
 * Right-side editor of one parameter.
 * name, definition: from the parameter schema; config: { value, force, rules } in the draft
 * onSave(config) resolves to true when saved
 */
export function ParameterEditor({ name, definition, config: initialConfig, fields, readOnly, onSave, onClose }) {
  const [config, setConfig] = useState(() => structuredClone(initialConfig ?? {}));
  const [mode, setMode] = useState('form');
  const [json, setJson] = useState('');
  const [jsonError, setJsonError] = useState(null);
  const [saving, setSaving] = useState(false);

  const problems = mode === 'form' ? problemsOf(definition, config) : {};
  const forced = config.force !== undefined;
  const rules = config.rules ?? [];
  const setRules = (next) => setConfig({ ...config, rules: next });

  function switchMode(next) {
    if (next === 'json') {
      setJson(JSON.stringify(tidy(config), null, 2));
      setJsonError(null);
    } else {
      try {
        setConfig(JSON.parse(json || '{}'));
        setJsonError(null);
      } catch (err) {
        setJsonError(`Not valid JSON: ${err.message}`);
        return;
      }
    }
    setMode(next);
  }

  async function save() {
    let next = config;
    if (mode === 'json') {
      try {
        next = JSON.parse(json || '{}');
      } catch (err) {
        setJsonError(`Not valid JSON: ${err.message}`);
        return;
      }
    }
    setSaving(true);
    const saved = await onSave(tidy(next));
    setSaving(false);
    if (saved) onClose();
  }

  const detail = typeDetail(definition);
  const subtitle = `${definition.type}${detail ? ` (${detail})` : ''} · built-in ${showValue(definition.default)}`;
  const blocked = Object.keys(problems).length > 0 || Boolean(jsonError);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        title={name}
        subtitle={subtitle}
        width={520}
        headerExtra={
          <Segmented
            value={mode}
            onValueChange={switchMode}
            options={[
              { value: 'form', label: 'Form' },
              { value: 'json', label: 'Raw JSON' },
            ]}
          />
        }
        footer={
          readOnly ? (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={blocked || saving} onClick={save}>
                {saving ? 'Saving…' : 'Save to draft'}
              </Button>
            </>
          )
        }
      >
        {definition.description && <p className="-mt-1 text-[0.8125rem] text-muted-foreground">{definition.description}</p>}

        {mode === 'json' ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              value={json}
              readOnly={readOnly}
              spellCheck={false}
              rows={18}
              onChange={(event) => {
                setJson(event.target.value);
                setJsonError(null);
              }}
              className="w-full rounded-md border border-input bg-card p-2.5 font-mono text-xs leading-relaxed outline-none focus-visible:border-ring"
            />
            <span className={cn('text-xs', jsonError ? 'text-destructive' : 'text-muted-foreground')}>
              {jsonError ?? 'value, force and rules of this parameter, as in the config document. The server checks it on save.'}
            </span>
          </div>
        ) : (
          <>
            <section className="flex flex-col gap-1.5">
              <span className="text-[0.8125rem] font-semibold">Server value</span>
              <div className="flex items-center gap-3">
                <ValueInput
                  definition={definition}
                  value={config.value}
                  allowUnset
                  disabled={readOnly}
                  invalid={Boolean(problems.value)}
                  onChange={(value) => setConfig({ ...config, value })}
                />
                {detail && definition.type !== 'string' && definition.type !== 'enum' && (
                  <span className="text-xs text-muted-foreground">
                    {definition.min !== undefined && definition.max !== undefined
                      ? `Between ${definition.min} and ${definition.max}`
                      : detail}
                  </span>
                )}
              </div>
              {problems.value && <span className="text-xs text-destructive">Server value {problems.value}</span>}
            </section>

            <section
              className={cn(
                'flex flex-col gap-2.5 rounded-lg border px-3 py-3',
                forced ? 'border-warning bg-warning-soft' : 'border-border',
              )}
            >
              <label className="flex items-center gap-3 text-[0.8125rem]">
                <Switch
                  tone="warning"
                  checked={forced}
                  disabled={readOnly}
                  onCheckedChange={(on) => {
                    const next = { ...config };
                    if (on) next.force = config.value ?? definition.default;
                    else delete next.force;
                    setConfig(next);
                  }}
                />
                <span className="font-medium">Force for everyone</span>
                <span className="ml-auto text-xs text-muted-foreground">overrides experiments and rules</span>
              </label>
              {forced && (
                <div className="flex flex-col gap-1">
                  <ValueInput
                    definition={definition}
                    value={config.force}
                    disabled={readOnly}
                    invalid={Boolean(problems.force)}
                    onChange={(force) => setConfig({ ...config, force })}
                  />
                  {problems.force && <span className="text-xs text-destructive">Forced value {problems.force}</span>}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[0.8125rem] font-semibold">Rules</span>
                <span className="text-xs text-muted-foreground">First match wins · drag to reorder</span>
              </div>
              {rules.map((rule, index) => (
                <RuleCard
                  key={index}
                  index={index}
                  rule={rule}
                  definition={definition}
                  fields={fields}
                  problem={problems[`rule${index}`]}
                  disabled={readOnly}
                  onChange={(next) => setRules(rules.map((item, i) => (i === index ? next : item)))}
                  onRemove={() => setRules(rules.filter((_, i) => i !== index))}
                  onMove={(from, to) => {
                    const next = [...rules];
                    const [moved] = next.splice(from, 1);
                    next.splice(to, 0, moved);
                    setRules(next);
                  }}
                />
              ))}
              {!readOnly && (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start border-dashed"
                  onClick={() => setRules([...rules, { when: {}, value: config.value ?? definition.default }])}
                >
                  <Plus />
                  Add rule
                </Button>
              )}
              <span className="text-xs text-muted-foreground">Otherwise: server value, then built-in value.</span>
            </section>
          </>
        )}
      </SheetContent>
    </Dialog>
  );
}
