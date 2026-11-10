'use client';

import Link from 'next/link';
import { CircleAlert, PencilLine, RefreshCw } from 'lucide-react';
import { useTransition } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/**
 * The draft above every Config tab: its size, errors, and what can be done with it.
 * actions: bound server actions { discard, rebase }; review: a callback or a link
 */
export function DraftBar({ draft, liveVersion, canEdit, actions, onReview, reviewHref }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  if (!draft) return null;

  const fail = (result) => toast.add({ title: result.error ?? 'Something went wrong', type: 'error' });
  const count = draft.changes.length;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 text-[0.8125rem] transition-opacity',
        draft.stale ? 'border-warning bg-warning-soft' : 'border-primary/40 bg-primary-soft',
        pending && 'opacity-60',
      )}
    >
      <PencilLine className={cn('size-4', draft.stale ? 'text-warning' : 'text-primary-soft-foreground')} />
      <span className="text-primary-soft-foreground">
        <b className="font-semibold">
          Draft: {count} change{count === 1 ? '' : 's'}
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
      {draft.stale && <span className="text-warning">v{liveVersion} was published after this draft was started.</span>}
      {canEdit && (
        <span className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            className="text-primary-soft-foreground"
            disabled={pending}
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
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await actions.rebase();
                  if (result.error) return fail(result);
                  const conflicts = result.data.conflicts;
                  toast.add({
                    title: conflicts.length
                      ? `Up to date; check ${conflicts.join(', ')}: changed on both sides`
                      : `Draft brought up to v${liveVersion}`,
                  });
                })
              }
            >
              <RefreshCw />
              Bring up to date
            </Button>
          ) : onReview ? (
            <Button onClick={onReview}>Review &amp; publish</Button>
          ) : (
            <Link href={reviewHref} className={buttonVariants()}>
              Review &amp; publish
            </Link>
          )}
        </span>
      )}
    </div>
  );
}
