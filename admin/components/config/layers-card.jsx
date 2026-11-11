'use client';

import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { layerOccupants } from '@/lib/config-format';
import { cn } from '@/lib/utils';

const NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

const pct = (value) => `${Math.round(value * 100) / 100}%`;

function Segment({ from, to, kind, label, title }) {
  return (
    <div
      title={title}
      style={{ left: `${from}%`, width: `${to - from}%` }}
      className={cn(
        'absolute inset-y-0.5 flex items-center overflow-hidden whitespace-nowrap rounded px-2 font-mono text-[0.6875rem] font-medium',
        kind === 'running' && 'bg-chart-1 text-primary-foreground',
        kind === 'draft' && 'border-[1.5px] border-dashed border-muted-foreground text-muted-foreground',
        kind === 'holdout' && 'bg-muted-foreground text-card',
        kind === 'free' && 'text-muted-foreground',
        kind === 'new' && 'bg-primary text-primary-foreground',
      )}
    >
      {label}
    </div>
  );
}

// Busy and free stretches of one layer; `except` is left out, `preview` drawn on top
function segmentsOf(document, layer, except, preview) {
  const segments = [];
  let at = 0;
  for (const [key, experiment] of layerOccupants(document, layer, except)) {
    const { from, to } = experiment.traffic;
    if (from > at) segments.push({ from: at, to: from, kind: 'free', label: `free ${pct(from - at)}` });
    segments.push({
      from,
      to,
      kind: experiment.status,
      label: `${key} · ${pct(to - from)}`,
      title: `${key} (${experiment.status}): ${pct(from)}–${pct(to)} of ${layer}`,
    });
    at = Math.max(at, to);
  }
  if (at < 100) segments.push({ from: at, to: 100, kind: 'free', label: `free ${pct(100 - at)}` });
  if (!preview) return segments;
  // Free stretches lose the part the new experiment takes
  const free = (from, to) => (to - from > 0 ? [{ from, to, kind: 'free', label: `free ${pct(to - from)}` }] : []);
  return [
    ...segments.flatMap((segment) =>
      segment.kind !== 'free' || segment.to <= preview.from || segment.from >= preview.to
        ? [segment]
        : [...free(segment.from, preview.from), ...free(preview.to, segment.to)],
    ),
    { ...preview, kind: 'new' },
  ];
}

/** One layer as a bar. except: an experiment to leave out; preview: { from, to, label } of a new one */
export function LayerBar({ document, layer, except = null, preview = null, className }) {
  return (
    <div className={cn('relative h-7 overflow-hidden rounded-md border border-border bg-muted', className)}>
      {segmentsOf(document, layer, except, preview).map((segment) => (
        <Segment key={`${segment.kind}-${segment.from}`} {...segment} />
      ))}
    </div>
  );
}

function Row({ name, meta, children, action }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_1.75rem] items-center gap-3">
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-mono text-xs font-medium">{name}</span>
        <span className="text-[0.6875rem] text-muted-foreground">{meta}</span>
      </span>
      {children}
      <span>{action}</span>
    </div>
  );
}

/**
 * Traffic layers of the document and who holds which part of each.
 * onAddLayer(name) and onRemoveLayer(name) resolve to true when saved
 */
export function LayersCard({ document, canEdit, onAddLayer, onRemoveLayer }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const holdout = document.holdout?.percent ?? 0;
  const problem = !name
    ? null
    : !NAME.test(name)
      ? 'Use snake_case, like onboarding'
      : document.layers.includes(name)
        ? 'There is a layer with this name'
        : null;

  async function add() {
    setSaving(true);
    const saved = await onAddLayer(name);
    setSaving(false);
    if (saved) {
      setAdding(false);
      setName('');
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2.5 px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Traffic layers</h2>
          <span className="text-xs text-muted-foreground">
            Experiments in one layer never overlap. Each user lands in one bucket per layer.
          </span>
        </div>
        <div className="flex items-center gap-3.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-3 rounded-[3px] bg-chart-1" />
            running
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-3 rounded-[3px] border-[1.5px] border-dashed border-muted-foreground" />
            draft
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-3 rounded-[3px] border border-border bg-muted" />
            free
          </span>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus />
              Add layer
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 px-4 pb-4 pt-1">
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_1.75rem] gap-3 text-xs tabular-nums text-muted-foreground">
          <span />
          <div className="flex justify-between">
            {['0%', '25%', '50%', '75%', '100%'].map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>
        </div>

        <Row name="holdout" meta="never in experiments">
          <div className="relative h-7 overflow-hidden rounded-md border border-border bg-muted">
            {holdout > 0 && (
              <Segment from={0} to={holdout} kind="holdout" label={pct(holdout)} title={`Holdout: ${pct(holdout)} of users never get experiments`} />
            )}
            <Segment from={holdout} to={100} kind="free" label="available to all layers" />
          </div>
        </Row>

        {document.layers.map((layer) => {
          const count = layerOccupants(document, layer).length;
          const used = Object.values(document.experiments).some((e) => e.layer === layer);
          return (
            <Row
              key={layer}
              name={layer}
              meta={`${count} experiment${count === 1 ? '' : 's'}`}
              action={
                canEdit &&
                !used &&
                document.layers.length > 1 && (
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove layer ${layer}`} onClick={() => onRemoveLayer(layer)}>
                    <X />
                  </Button>
                )
              }
            >
              <LayerBar document={document} layer={layer} />
            </Row>
          );
        })}
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent
          title="Add a layer"
          description="Experiments in different layers run on the same users independently. Use a new layer for a part of the app no other experiment touches."
          footer={
            <>
              <Button variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button disabled={!name || Boolean(problem) || saving} onClick={add}>
                Add to draft
              </Button>
            </>
          }
        >
          <Field label="Name" error={problem}>
            <Input mono autoFocus value={name} onChange={(event) => setName(event.target.value.trim())} placeholder="onboarding" />
          </Field>
        </DialogContent>
      </Dialog>
    </section>
  );
}
