'use client';

import { Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { showValue, trafficLimit } from '@/lib/config-format';
import { cn } from '@/lib/utils';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every dialog: open while `experimentKey` is set; onSave(nextExperiment, extra) resolves to true when saved
function useSaving(onSave, onClose) {
  const [saving, setSaving] = useState(false);
  return [
    saving,
    async (...args) => {
      setSaving(true);
      const saved = await onSave(...args);
      setSaving(false);
      if (saved) onClose();
    },
  ];
}

/** More traffic for a running experiment: users already in keep their variant */
export function IncreaseTrafficDialog({ document, experimentKey, onSave, onClose }) {
  const experiment = document.experiments[experimentKey];
  const limit = trafficLimit(document, experimentKey);
  const [to, setTo] = useState(() => String(Math.min(limit, experiment.traffic.to + 10)));
  const [saving, save] = useSaving(onSave, onClose);

  const value = Number(to);
  const problem =
    !Number.isFinite(value) || Math.round(value * 100) !== value * 100
      ? 'A number with at most two decimals'
      : value <= experiment.traffic.to
        ? `More than the current ${experiment.traffic.to}%`
        : value > limit
          ? `At most ${limit}%: the next experiment in ${experiment.layer} starts there`
          : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Increase traffic of ${experimentKey}`}
        description="New users come in; everyone already in the experiment keeps their variant. Traffic can only grow while it runs."
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={Boolean(problem) || saving}
              onClick={() => save({ ...experiment, traffic: { ...experiment.traffic, to: value } })}
            >
              Save to draft
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <span className="text-muted-foreground">
            Now {experiment.traffic.from}–{experiment.traffic.to}% of <span className="font-mono">{experiment.layer}</span>
          </span>
          <Field label="Up to" hint={`at most ${limit}%`} error={problem}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={experiment.traffic.to}
                max={limit}
                step={1}
                value={Number.isFinite(value) ? value : experiment.traffic.to}
                onChange={(event) => setTo(event.target.value)}
                className="flex-1 accent-[var(--primary)]"
              />
              <Input mono value={to} onChange={(event) => setTo(event.target.value)} className="w-20 text-right" />
              <span className="text-muted-foreground">%</span>
            </div>
          </Field>
          {!problem && (
            <span className="text-xs text-muted-foreground">
              Share of the layer: {Math.round((value - experiment.traffic.from) * 100) / 100}%
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Stops a running experiment, optionally making one variant the normal config */
export function StopExperimentDialog({ document, experimentKey, onSave, onClose }) {
  const experiment = document.experiments[experimentKey];
  const [reason, setReason] = useState('');
  const [applied, setApplied] = useState(null);
  const [saving, save] = useSaving(onSave, onClose);
  const variants = Object.entries(experiment.variants).sort(([a], [b]) => a.localeCompare(b));

  function stop() {
    const outcome = { reason: reason.trim(), ...(applied ? { applied_variant: applied } : {}) };
    save({ ...experiment, status: 'stopped', outcome }, applied);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        width={520}
        title={`Stop ${experimentKey}?`}
        description="Everyone goes back to the normal config. Results stay available. The stop goes into the draft and happens when you publish."
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={reason.trim().length < 3 || saving} onClick={stop}>
              Stop experiment
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">After the stop</span>
            {[null, ...variants.map(([name]) => name)].map((name) => {
              const values = name ? Object.entries(experiment.variants[name].values) : [];
              return (
                <label
                  key={name ?? 'none'}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5',
                    applied === name ? 'border-primary bg-primary-soft/40' : 'border-border',
                  )}
                >
                  <input
                    type="radio"
                    name="applied"
                    checked={applied === name}
                    onChange={() => setApplied(name)}
                    className="mt-0.5 size-4 accent-[var(--primary)]"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">
                      {name ? (
                        <>
                          Make <span className="font-mono text-xs">{name}</span> the new normal
                        </>
                      ) : (
                        'Keep the config as it is'
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {name
                        ? `Sets the server value: ${values.map(([parameter, value]) => `${parameter} = ${showValue(value)}`).join(', ')}`
                        : 'No winner, or decide later on Parameters'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <Field label="Reason" hint="required, shown in the review and Versions">
            <Textarea
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. trial_first wins with 91% chance after 12 days"
            />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Testers always get the variant set here, even outside traffic and targeting; they are not counted in results */
export function TestersDialog({ document, experimentKey, readOnly, onSave, onClose }) {
  const experiment = document.experiments[experimentKey];
  const variantItems = Object.keys(experiment.variants)
    .sort()
    .map((name) => ({ value: name, label: name }));
  const [rows, setRows] = useState(() => Object.entries(experiment.forced ?? {}));
  const [userId, setUserId] = useState('');
  const [variant, setVariant] = useState(variantItems[0]?.value ?? null);
  const [saving, save] = useSaving(onSave, onClose);

  const id = userId.trim().toLowerCase();
  const problem = !id ? null : !UUID.test(id) ? 'A user ID looks like 019a4c2e-…' : rows.some(([known]) => known === id) ? 'Already a tester' : null;

  function apply() {
    const next = { ...experiment };
    if (rows.length) next.forced = Object.fromEntries(rows);
    else delete next.forced;
    save(next);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        width={560}
        title={`Testers of ${experimentKey}`}
        description="Testers always get the chosen variant, above holdout, traffic and targeting. They are left out of the results."
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
              <Button disabled={saving} onClick={apply}>
                Save to draft
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-2">
          {rows.length === 0 && <span className="text-muted-foreground">No testers yet.</span>}
          {rows.map(([known, chosen], index) => (
            <div key={known} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{known}</span>
              <Select
                mono
                value={chosen}
                items={variantItems}
                onValueChange={(next) => setRows(rows.map((row, i) => (i === index ? [known, next] : row)))}
              />
              {!readOnly && (
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${known}`} onClick={() => setRows(rows.filter((_, i) => i !== index))}>
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
          {!readOnly && (
            <div className="mt-2 flex items-start gap-2 border-t border-border pt-3">
              <Field className="flex-1" error={problem}>
                <Input mono value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="User ID from Support or the Sandbox" />
              </Field>
              <Select mono value={variant} items={variantItems} onValueChange={setVariant} />
              <Button
                variant="outline"
                disabled={!id || Boolean(problem)}
                onClick={() => {
                  setRows([...rows, [id, variant]]);
                  setUserId('');
                }}
              >
                <Plus />
                Add
              </Button>
            </div>
          )}
          {experiment.status === 'stopped' && (
            <span className="flex items-center gap-1.5 text-xs text-warning">
              <TriangleAlert className="size-3.5" />
              The experiment is stopped: testers no longer get anything from it.
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
