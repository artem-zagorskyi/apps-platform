'use client';

import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { DraftBar } from '@/components/config/draft-bar';
import { ParameterEditor } from '@/components/config/parameter-editor';
import { ReviewPublish } from '@/components/config/review-publish';
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
export function ParametersWorkspace({ overview, actions, canEdit, initialReview = false }) {
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const [reviewing, setReviewing] = useState(initialReview && Boolean(overview.draft));

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
    <div className="flex flex-col gap-4">
      <DraftBar
        draft={draft}
        liveVersion={live?.version ?? null}
        canEdit={canEdit}
        actions={actions}
        onReview={() => setReviewing(true)}
      />

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
