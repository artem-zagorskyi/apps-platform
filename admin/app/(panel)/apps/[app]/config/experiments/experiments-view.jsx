'use client';

import Link from 'next/link';
import { Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DraftBar } from '@/components/config/draft-bar';
import { IncreaseTrafficDialog, StopExperimentDialog, TestersDialog } from '@/components/config/experiment-dialogs';
import { ExperimentWizard } from '@/components/config/experiment-wizard';
import { LayersCard } from '@/components/config/layers-card';
import { useDraftDocument } from '@/components/config/use-draft-document';
import { StatusBadge } from '@/components/data/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { dayNumber, liftText, metricLabel, trafficLimit, trafficShare, variantsText } from '@/lib/config-format';
import { cn } from '@/lib/utils';

const GROUPS = [
  { status: 'running', label: 'Running', head: 'Leader on primary metric' },
  { status: 'draft', label: 'Draft', head: 'Plan' },
  { status: 'stopped', label: 'Stopped', head: 'Outcome' },
];

const GRID =
  'grid grid-cols-[minmax(12rem,1.3fr)_6rem_4rem_4rem_4.5rem_5.5rem_minmax(11rem,1.4fr)_17rem] items-center gap-3 px-4';
const numberFormat = new Intl.NumberFormat('en-US');

// Health of a started experiment from the results summary
function Health({ summary }) {
  if (!summary) return <span className="text-muted-foreground">—</span>;
  if (summary.healthy === false) return <StatusBadge status="srm" title="Users did not split by the weights" />;
  if (summary.healthy === true) return <StatusBadge status="ok" title="Traffic split as expected" />;
  return <StatusBadge status="waiting" label="collecting" title="Not enough users to judge yet" />;
}

// "trial_first · +8.4% · 91% chance", and guardrails a variant hurts
function Leader({ experiment, summary }) {
  if (!experiment.primary_metric) return <span className="text-muted-foreground">no primary metric</span>;
  const metric = <span className="truncate text-xs text-muted-foreground">{metricLabel(experiment.primary_metric)}</span>;
  if (!summary?.leader) {
    return (
      <span className="flex min-w-0 flex-col leading-snug">
        <span className="text-muted-foreground">Collecting data</span>
        {metric}
      </span>
    );
  }
  const { variant, lift, chanceToWin } = summary.leader;
  return (
    <span className="flex min-w-0 flex-col leading-snug">
      <span className="truncate">
        <span className="font-mono text-xs">{variant}</span> · {liftText(lift)} · {Math.round(chanceToWin * 100)}% chance
      </span>
      {summary.hurt.length > 0 ? (
        <span className="truncate text-xs text-destructive">
          worse: {summary.hurt.map((item) => `${metricLabel(item.metric)} in ${item.variant}`).join(', ')}
        </span>
      ) : (
        metric
      )}
    </span>
  );
}


// What the draft does to the experiment once published, or null
function pendingOf(base, current) {
  if (!current) return 'Removed on publish';
  if (!base) return current.status === 'running' ? 'Starts on publish' : 'New in the draft';
  if (base.status === 'draft' && current.status === 'running') return 'Starts on publish';
  if (base.status === 'running' && current.status === 'stopped') return 'Stops on publish';
  if (base.traffic.to !== current.traffic.to) return `${trafficShare(current)}% on publish`;
  if (JSON.stringify(base.forced ?? {}) !== JSON.stringify(current.forced ?? {})) return 'Testers change on publish';
  return null;
}

function dayText(experiment) {
  if (!experiment.started_at) return '—';
  if (experiment.status === 'stopped' && experiment.stopped_at) {
    return `${dayNumber(experiment.started_at, experiment.stopped_at)} d`;
  }
  return `day ${dayNumber(experiment.started_at)}`;
}

function Info({ group, base, current, summary }) {
  const experiment = current ?? base;
  if (group === 'running') return <Leader experiment={base} summary={summary} />;
  if (group === 'stopped') {
    const outcome = experiment.outcome;
    if (!outcome) return <span className="text-muted-foreground">—</span>;
    return (
      <span className="flex min-w-0 flex-col leading-snug">
        <span>
          {outcome.applied_variant ? (
            <>
              <span className="font-mono text-xs">{outcome.applied_variant}</span> became the normal config
            </>
          ) : (
            'Config kept as it was'
          )}
        </span>
        <span className="truncate text-xs text-muted-foreground" title={outcome.reason}>
          {outcome.reason}
        </span>
      </span>
    );
  }
  const conditions = Object.keys(experiment.targeting ?? {}).length;
  return (
    <span className="flex min-w-0 flex-col leading-snug">
      <span className={cn('truncate', experiment.primary_metric ? 'font-mono text-xs' : 'text-muted-foreground')}>
        {experiment.primary_metric ? metricLabel(experiment.primary_metric) : 'no primary metric'}
        {experiment.guardrail_metrics?.length ? (
          <span className="font-sans text-muted-foreground"> + {experiment.guardrail_metrics.length} guardrail{experiment.guardrail_metrics.length === 1 ? '' : 's'}</span>
        ) : null}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {conditions ? `${conditions} targeting condition${conditions === 1 ? '' : 's'}` : 'all users'}
      </span>
    </span>
  );
}

/**
 * overview: { live, draft, schema, conditionFields } from the admin API
 * events: [{ name, category }] for the primary metric; dailyUsers: DAU or null
 * actions: bound server actions { save, discard, rebase }
 */
export function ExperimentsView({ overview, canEdit, events, dailyUsers, summary = [], resultsHref, reviewHref, actions }) {
  const summaryOf = (key) => summary.find((item) => item.key === key) ?? null;
  const { document, save } = useDraftDocument(overview, actions.save);
  const [dialog, setDialog] = useState(null);
  const liveExperiments = overview.live?.document.experiments ?? {};

  const setExperiment = (key, experiment, title, parameters = document.parameters) =>
    save({ ...document, parameters, experiments: { ...document.experiments, [key]: experiment } }, title);

  const rows = [...new Set([...Object.keys(liveExperiments), ...Object.keys(document.experiments)])].sort().map((key) => {
    const base = liveExperiments[key];
    const current = document.experiments[key];
    const group = base ? base.status : 'draft';
    return { key, base, current, group, pending: pendingOf(base, current) };
  });

  function actionsOf({ key, base, current }) {
    const results = base?.started_at && (
      <Link href={`${resultsHref}?experiment=${encodeURIComponent(key)}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        Results
      </Link>
    );
    if (!canEdit || !current) return results;
    const testers = `Testers${current.forced ? ` · ${Object.keys(current.forced).length}` : ''}`;
    // Less frequent actions, so a row keeps one line
    const more = (items) => (
      <Menu>
        <MenuTrigger aria-label={`More for ${key}`} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
          <Ellipsis />
        </MenuTrigger>
        <MenuContent align="end">{items}</MenuContent>
      </Menu>
    );

    if (current.status === 'running' && base?.status === 'running') {
      return (
        <>
          {results}
          {trafficLimit(document, key) > current.traffic.to && (
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'traffic', key })}>
              Increase traffic
            </Button>
          )}
          <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive-soft" onClick={() => setDialog({ kind: 'stop', key })}>
            Stop
          </Button>
          {more(<MenuItem onClick={() => setDialog({ kind: 'testers', key })}>{testers}</MenuItem>)}
        </>
      );
    }
    if (current.status === 'running') {
      return (
        <Button variant="outline" size="sm" onClick={() => setExperiment(key, { ...current, status: 'draft' }, `${key} back to draft`)}>
          Keep as draft
        </Button>
      );
    }
    if (current.status === 'draft') {
      return (
        <>
          <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'edit', key })}>
            <Pencil />
            Edit
          </Button>
          <Button size="sm" onClick={() => setExperiment(key, { ...current, status: 'running' }, `${key} starts when you publish`)}>
            Start
          </Button>
          {more(
            <>
              <MenuItem onClick={() => setDialog({ kind: 'testers', key })}>{testers}</MenuItem>
              <MenuItem
                destructive
                onClick={() => {
                  const experiments = { ...document.experiments };
                  delete experiments[key];
                  save({ ...document, experiments }, `${key} deleted in the draft`);
                }}
              >
                <Trash2 />
                Delete
              </MenuItem>
            </>,
          )}
        </>
      );
    }
    return results;
  }

  const open = dialog && (dialog.kind === 'new' || document.experiments[dialog.key]);
  const close = () => setDialog(null);

  return (
    <div className="flex flex-col gap-4">
      <DraftBar draft={overview.draft} liveVersion={overview.live?.version ?? null} canEdit={canEdit} actions={actions} reviewHref={reviewHref} />

      {canEdit && (
        <div className="-mb-1 flex justify-end">
          <Button onClick={() => setDialog({ kind: 'new' })}>
            <Plus />
            New experiment
          </Button>
        </div>
      )}

      <LayersCard
        document={document}
        canEdit={canEdit}
        onAddLayer={(name) => save({ ...document, layers: [...document.layers, name] }, `Layer ${name} added to the draft`)}
        onRemoveLayer={(name) =>
          save({ ...document, layers: document.layers.filter((layer) => layer !== name) }, `Layer ${name} removed in the draft`)
        }
      />

      {rows.length === 0 && (
        <section className="rounded-lg border border-border bg-card px-4 py-5 text-[0.8125rem] text-muted-foreground">
          No experiments yet.
        </section>
      )}

      {GROUPS.map(({ status, label, head }) => {
        const items = rows.filter((row) => row.group === status);
        if (items.length === 0) return null;
        return (
          <section key={status} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 px-4 py-2.5">
              <h2 className="text-sm font-semibold">{label}</h2>
              <span className="text-xs text-muted-foreground">{items.length}</span>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[70rem]">
                <div className={cn(GRID, 'h-8 border-t border-border bg-muted text-xs font-medium text-muted-foreground')}>
                  <span>Experiment</span>
                  <span>Layer</span>
                  <span className="text-right">Traffic</span>
                  <span className="text-right">Day</span>
                  <span className="text-right">Exposed</span>
                  <span>Health</span>
                  <span>{head}</span>
                  <span />
                </div>
                {items.map((row) => {
                  const experiment = row.current ?? row.base;
                  const trafficChanged = row.base && row.current && row.base.traffic.to !== row.current.traffic.to;
                  return (
                    <div key={row.key} className={cn(GRID, 'min-h-12 border-t border-border py-1.5 text-[0.8125rem] tabular-nums')}>
                      <span className="flex min-w-0 flex-col leading-snug" title={experiment.description}>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-mono text-xs font-medium">{row.key}</span>
                          {row.pending && (
                            <span className="shrink-0 whitespace-nowrap rounded-[0.25rem] bg-primary-soft px-1.5 py-0.5 text-[0.6875rem] font-medium text-primary-soft-foreground">
                              {row.pending}
                            </span>
                          )}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">{variantsText(experiment)}</span>
                      </span>
                      <span className="truncate font-mono text-xs text-muted-foreground">{experiment.layer}</span>
                      <span className="text-right">
                        {trafficChanged ? (
                          <>
                            <span className="text-muted-foreground line-through">{trafficShare(row.base)}%</span> {trafficShare(row.current)}%
                          </>
                        ) : (
                          `${trafficShare(experiment)}%`
                        )}
                      </span>
                      <span className="text-right text-muted-foreground">{dayText(row.base ?? experiment)}</span>
                      <span className="text-right">
                        {summaryOf(row.key) ? numberFormat.format(summaryOf(row.key).users) : <span className="text-muted-foreground">—</span>}
                      </span>
                      <span>{row.group === 'draft' ? <span className="text-muted-foreground">—</span> : <Health summary={summaryOf(row.key)} />}</span>
                      <Info group={row.group} base={row.base} current={row.current} summary={summaryOf(row.key)} />
                      <span className="flex flex-wrap items-center justify-end gap-1.5">
                        {actionsOf(row)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}

      {open && (dialog.kind === 'new' || dialog.kind === 'edit') && (
        <ExperimentWizard
          document={document}
          schema={overview.schema ?? { parameters: {} }}
          targetingFields={overview.conditionFields.targeting}
          liveKeys={Object.keys(liveExperiments)}
          events={events}
          dailyUsers={dailyUsers}
          editing={dialog.kind === 'edit' ? dialog.key : null}
          onClose={close}
          onSave={(key, experiment, title) => setExperiment(key, experiment, title)}
        />
      )}
      {open && dialog.kind === 'traffic' && (
        <IncreaseTrafficDialog
          document={document}
          experimentKey={dialog.key}
          onClose={close}
          onSave={(next) => setExperiment(dialog.key, next, `${dialog.key}: ${trafficShare(next)}% when you publish`)}
        />
      )}
      {open && dialog.kind === 'stop' && (
        <StopExperimentDialog
          document={document}
          experimentKey={dialog.key}
          onClose={close}
          onSave={(next, applied) => {
            // The winner's values become the server values of its parameters
            const parameters = { ...document.parameters };
            for (const [name, value] of Object.entries(applied ? next.variants[applied].values : {})) {
              parameters[name] = { ...parameters[name], value };
            }
            return setExperiment(dialog.key, next, `${dialog.key} stops when you publish`, parameters);
          }}
        />
      )}
      {open && dialog.kind === 'testers' && (
        <TestersDialog
          document={document}
          experimentKey={dialog.key}
          readOnly={!canEdit}
          onClose={close}
          onSave={(next) => setExperiment(dialog.key, next, `Testers of ${dialog.key} saved to the draft`)}
        />
      )}
    </div>
  );
}
