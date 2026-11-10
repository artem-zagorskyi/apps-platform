'use client';

import { Check as CheckIcon, ChevronLeft, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { readableProblem, showValue, splitChangePath } from '@/lib/config-format';
import { cn } from '@/lib/utils';

const RULES_PART = /^rules$/;

// Rules are long: their count says enough in the summary
function shown(part, value) {
  if (value === undefined) return null;
  if (part && RULES_PART.test(part) && Array.isArray(value)) return `${value.length} rule${value.length === 1 ? '' : 's'}`;
  if (part === 'status' || part === null) return typeof value === 'string' ? value : showValue(value);
  return showValue(value);
}

function Before({ children }) {
  return (
    <span className="max-w-[26rem] truncate rounded bg-destructive-soft px-1.5 font-mono text-xs line-through decoration-destructive">
      {children}
    </span>
  );
}

function After({ children }) {
  return <span className="max-w-[26rem] truncate rounded bg-success-soft px-1.5 font-mono text-xs">{children}</span>;
}

function ChangeRow({ change }) {
  const { group, part, mono } = splitChangePath(change.path);
  const before = shown(part, change.before);
  const after = shown(part, change.after);
  return (
    <div className="grid grid-cols-[13rem_minmax(0,1fr)] items-start gap-3 border-t border-border px-4 py-2.5 text-[0.8125rem]">
      <span className={cn('truncate pt-0.5', mono && 'font-mono text-xs')}>{group}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {part && <span className="font-mono text-xs text-muted-foreground">{part}</span>}
        {change.kind === 'added' ? (
          <After>{after}</After>
        ) : change.kind === 'removed' ? (
          <>
            <Before>{before}</Before>
            <span className="text-muted-foreground">→ none</span>
          </>
        ) : (
          <>
            <Before>{before}</Before>
            <span className="text-muted-foreground">→</span>
            <After>{after}</After>
          </>
        )}
      </span>
    </div>
  );
}

function CheckRow({ ok, warning, children, action }) {
  const Icon = ok ? CheckIcon : warning ? TriangleAlert : X;
  return (
    <div className="flex items-center gap-2.5 py-1 text-[0.8125rem]">
      <span
        className={cn(
          'flex size-[1.125rem] shrink-0 items-center justify-center rounded-full',
          ok ? 'bg-success-soft text-success' : warning ? 'bg-warning-soft text-warning' : 'bg-destructive-soft text-destructive',
        )}
      >
        <Icon className="size-3" strokeWidth={3} />
      </span>
      <span className="flex-1">{children}</span>
      {action}
    </div>
  );
}

/**
 * Review of the draft before publishing.
 * draft: { changes, errors, warnings, stale }; liveVersion: number | null
 * onPublish(comment) resolves to true when published; onEdit(parameter) opens its editor
 */
export function ReviewPublish({ draft, liveVersion, readOnly, onBack, onEdit, onPublish }) {
  const [comment, setComment] = useState('');
  const [publishing, setPublishing] = useState(false);
  const next = (liveVersion ?? 0) + 1;
  const parameterOf = (text) => text.match(/^parameters\.([a-z0-9_]+)/)?.[1] ?? null;
  const blocked = draft.errors.length > 0 || draft.stale || !comment.trim() || readOnly;

  return (
    <section className="max-w-[56rem] overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 px-4 py-3">
        <Button variant="outline" size="icon-sm" aria-label="Back to editing" onClick={onBack}>
          <ChevronLeft />
        </Button>
        <div className="flex flex-col">
          <span className="text-sm font-semibold">
            Review changes · {liveVersion ? `v${liveVersion}` : 'nothing published'} → v{next}
          </span>
          <span className="text-xs text-muted-foreground">Compared field by field with the live version</span>
        </div>
      </div>

      {draft.changes.length === 0 ? (
        <div className="border-t border-border px-4 py-3 text-[0.8125rem] text-muted-foreground">
          The draft is the same as the live version.
        </div>
      ) : (
        draft.changes.map((change) => <ChangeRow key={change.path} change={change} />)
      )}

      <div className="flex flex-col border-t border-border px-4 py-3">
        <span className="mb-1 text-xs font-medium text-muted-foreground">Server checks</span>
        {draft.stale && (
          <CheckRow>A newer version was published after this draft was started. Bring the draft up to date first.</CheckRow>
        )}
        {draft.errors.length === 0 ? (
          <CheckRow ok>Every value fits its parameter, and running experiments stay as they started</CheckRow>
        ) : (
          draft.errors.map((error) => {
            const parameter = parameterOf(error);
            return (
              <CheckRow
                key={error}
                action={
                  parameter &&
                  !readOnly && (
                    <Button variant="outline" size="sm" onClick={() => onEdit(parameter)}>
                      Edit parameter
                    </Button>
                  )
                }
              >
                <span className="font-mono text-xs">{readableProblem(error)}</span>
              </CheckRow>
            );
          })
        )}
        {draft.warnings.length === 0 ? (
          <CheckRow ok>No running experiment uses a parameter that this draft forces</CheckRow>
        ) : (
          draft.warnings.map((warning) => (
            <CheckRow key={warning} warning>
              {warning}
            </CheckRow>
          ))
        )}
      </div>

      <label className="flex flex-col gap-1 border-t border-border px-4 py-3">
        <span className="text-[0.8125rem] font-semibold">Comment</span>
        <span className="text-xs text-muted-foreground">required · shown in Versions and the audit log</span>
        <textarea
          value={comment}
          rows={2}
          maxLength={500}
          disabled={readOnly}
          onChange={(event) => setComment(event.target.value)}
          placeholder="e.g. Raise the daily goal to 20 minutes"
          className="mt-1.5 w-full rounded-md border border-input bg-card px-2.5 py-2 text-[0.8125rem] outline-none focus-visible:border-ring"
        />
      </label>

      <div className="flex items-center gap-2 border-t border-border bg-muted px-4 py-3">
        <span className="flex-1 text-xs text-muted-foreground">
          {draft.errors.length > 0
            ? `Fix ${draft.errors.length} error${draft.errors.length === 1 ? '' : 's'} to publish`
            : draft.stale
              ? 'Bring the draft up to date to publish'
              : !comment.trim()
                ? 'Add a comment to publish'
                : 'Ready to publish'}
        </span>
        <Button variant="outline" onClick={onBack}>
          Back to editing
        </Button>
        <Button
          disabled={blocked || publishing}
          onClick={async () => {
            setPublishing(true);
            const done = await onPublish(comment.trim());
            setPublishing(false);
            if (done) setComment('');
          }}
        >
          {publishing ? 'Publishing…' : `Publish v${next}`}
        </Button>
      </div>
    </section>
  );
}
