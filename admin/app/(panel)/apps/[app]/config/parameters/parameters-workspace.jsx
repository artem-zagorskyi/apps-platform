'use client';

import { ChevronRight, CircleAlert, PencilLine, RefreshCw } from 'lucide-react';
import { useState, useTransition } from 'react';
import { ParameterEditor } from '@/components/config/parameter-editor';
import { ReviewPublish } from '@/components/config/review-publish';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { decidedBy, showValue, splitChangePath, typeDetail } from '@/lib/config-format';
import { cn } from '@/lib/utils';

const DECIDED_CLASS = {
  force: 'border-transparent bg-warning-soft text-warning',
  experiment: 'border-transparent bg-primary-soft text-primary-soft-foreground',
  rule: 'border-border text-foreground',
  server: 'border-border text-foreground',
  'built-in': 'border-border text-muted-foreground',
};

const GRID = 'grid grid-cols-[minmax(14rem,1.6fr)_7.5rem_minmax(7rem,0.8fr)_minmax(9rem,1.2fr)_3.5rem_minmax(11rem,1fr)_1rem] items-center gap-3 px-4';

/**
 * overview: { live, draft, schema, conditionFields } from the admin API
 * actions: bound server actions { save, discard, rebase, publish }, each resolving to { ok, data } or { error }
 */
export function ParametersWorkspace({ overview, actions, canEdit }) {
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [pending, startTransition] = useTransition();

  const { live, draft, schema, conditionFields } = overview;
  const document = draft?.document ?? live?.document ?? { format_version: 1, parameters: {}, experiments: {} };
  const declared = Object.entries(schema?.parameters ?? {}).sort(
    ([a, x], [b, y]) => Number(Boolean(x.deprecated)) - Number(Boolean(y.deprecated)) || a.localeCompare(b),
  );
  const deprecated = declared.filter(([, definition]) => definition.deprecated).length;
  const changed = new Set((draft?.changes ?? []).map((change) => splitChangePath(change.path).group));
  const withErrors = new Set(
    (draft?.errors ?? []).flatMap((error) => error.match(/^parameters\.([a-z0-9_]+)/)?.[1] ?? []),
  );

  const fail = (result) => toast.add({ title: result.error ?? 'Something went wrong', type: 'error' });

  async function saveParameter(name, config) {
    const parameters = { ...document.parameters };
    if (Object.keys(config).length === 0) delete parameters[name];
    else parameters[name] = config;

    const result = await actions.save({
      document: { ...document, parameters },
      baseVersion: draft ? draft.baseVersion : (live?.version ?? null),
      expectedUpdatedAt: draft?.updatedAt ?? null,
    });
    if (result.error) {
      fail(result);
      return false;
    }
    toast.add({ title: `${name} saved to the draft` });
    return true;
  }

  async function publish(comment) {
    const result = await actions.publish(comment);
    if (result.error) {
      fail(result);
      return false;
    }
    toast.add({
      title: result.data.status === 'created' ? `Config v${result.data.version} published` : 'Nothing to publish: same as live',
    });
    setReviewing(false);
    return true;
  }

  const editor = editing && (
    <ParameterEditor
      key={editing}
      name={editing}
      definition={schema.parameters[editing]}
      config={document.parameters[editing]}
      fields={conditionFields.rules}
      readOnly={!canEdit}
      onSave={(config) => saveParameter(editing, config)}
      onClose={() => setEditing(null)}
    />
  );

  if (reviewing && draft) {
    return (
      <>
        <ReviewPublish
          draft={draft}
          liveVersion={live?.version ?? null}
          readOnly={!canEdit}
          onBack={() => setReviewing(false)}
          onEdit={(name) => setEditing(name)}
          onPublish={publish}
        />
        {editor}
      </>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4 transition-opacity', pending && 'opacity-60')}>
      {draft && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 text-[0.8125rem]',
            draft.stale ? 'border-warning bg-warning-soft' : 'border-primary/40 bg-primary-soft',
          )}
        >
          <PencilLine className={cn('size-4', draft.stale ? 'text-warning' : 'text-primary-soft-foreground')} />
          <span className="text-primary-soft-foreground">
            <b className="font-semibold">
              Draft: {draft.changes.length} change{draft.changes.length === 1 ? '' : 's'}
            </b>{' '}
            on top of {draft.baseVersion ? `v${draft.baseVersion}` : 'nothing published'}. Nothing reaches users until you
            publish.
          </span>
          {draft.errors.length > 0 && (
            <span className="inline-flex items-center gap-1 text-destructive">
              <CircleAlert className="size-3.5" />
              {draft.errors.length} error{draft.errors.length === 1 ? '' : 's'}
            </span>
          )}
          {draft.stale && (
            <span className="text-warning">v{live?.version} was published after this draft was started.</span>
          )}
          {canEdit && (
            <span className="ml-auto flex items-center gap-1.5">
              <Button
                variant="ghost"
                className="text-primary-soft-foreground"
                onClick={() =>
                  startTransition(async () => {
                    const result = await actions.discard();
                    if (result.error) fail(result);
                    else toast.add({ title: 'Draft discarded' });
                  })
                }
              >
                Discard
              </Button>
              {draft.stale ? (
                <Button
                  onClick={() =>
                    startTransition(async () => {
                      const result = await actions.rebase();
                      if (result.error) return fail(result);
                      const conflicts = result.data.conflicts;
                      toast.add({
                        title: conflicts.length
                          ? `Up to date; check ${conflicts.join(', ')}: changed on both sides`
                          : `Draft brought up to v${live?.version}`,
                      });
                    })
                  }
                >
                  <RefreshCw />
                  Bring up to date
                </Button>
              ) : (
                <Button onClick={() => setReviewing(true)}>Review &amp; publish</Button>
              )}
            </span>
          )}
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3">
          <span className="text-sm font-semibold">Parameters</span>
          <span className="text-xs text-muted-foreground">
            {declared.length}
            {deprecated > 0 && ` · ${deprecated} deprecated`}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            Priority: force → experiment → first matching rule → server value → built-in
          </span>
        </div>

        {declared.length === 0 ? (
          <div className="border-t border-border px-4 py-5 text-[0.8125rem] text-muted-foreground">
            No parameters declared yet. Upload remote_config.json in App settings → Config.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[60rem]">
              <div className={cn(GRID, 'h-8 border-t border-border bg-muted text-xs font-medium text-muted-foreground')}>
                <span>Name</span>
                <span>Type</span>
                <span>Built-in</span>
                <span>Server</span>
                <span className="text-right">Rules</span>
                <span>What decides now</span>
                <span />
              </div>
              {declared.map(([name, definition]) => {
                const config = document.parameters[name];
                const decision = decidedBy(name, config, document);
                const detail = typeDetail(definition);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setEditing(name)}
                    className={cn(
                      GRID,
                      'min-h-11 w-full border-t border-border py-1.5 text-left text-[0.8125rem] hover:bg-accent',
                      definition.deprecated && 'opacity-60',
                    )}
                  >
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-mono text-xs font-medium">{name}</span>
                        {changed.has(name) && <span title="Changed in the draft" className="size-1.5 shrink-0 rounded-full bg-primary" />}
                        {definition.deprecated && (
                          <span className="rounded-[0.25rem] border border-border px-1 text-[0.625rem] text-muted-foreground">
                            deprecated
                          </span>
                        )}
                      </span>
                      {definition.description && (
                        <span className="truncate text-xs text-muted-foreground">{definition.description}</span>
                      )}
                    </span>
                    <span className="flex flex-col leading-tight">
                      <span className="font-mono text-xs">{definition.type}</span>
                      {detail && <span className="font-mono text-[0.6875rem] text-muted-foreground">{detail}</span>}
                    </span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{showValue(definition.default)}</span>
                    <span
                      className={cn(
                        'truncate font-mono text-xs',
                        withErrors.has(name) && 'text-destructive',
                        config?.value === undefined && 'text-muted-foreground',
                      )}
                    >
                      {showValue(config?.value)}
                    </span>
                    <span className="text-right tabular-nums text-muted-foreground">{config?.rules?.length || '—'}</span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={cn(
                          'inline-flex h-[1.375rem] items-center rounded-[0.3125rem] border px-[0.4375rem] font-mono text-xs',
                          DECIDED_CLASS[decision.kind],
                        )}
                      >
                        {decision.kind === 'force' ? `force = ${showValue(config.force)}` : decision.label}
                      </span>
                      {decision.detail && <span className="truncate text-xs text-muted-foreground">{decision.detail}</span>}
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>
      {editor}
    </div>
  );
}
