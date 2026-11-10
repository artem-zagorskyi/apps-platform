'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DraftBar } from '@/components/config/draft-bar';
import { ChangeRow } from '@/components/config/review-publish';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const GRID = 'grid grid-cols-[2rem_2rem_4.5rem_10.5rem_minmax(10rem,0.9fr)_minmax(12rem,1.6fr)_8.5rem] items-center gap-3 px-4';

function Radio({ checked, label, onChange }) {
  return (
    <span className="flex justify-center">
      <input
        type="radio"
        checked={checked}
        aria-label={label}
        onChange={onChange}
        className="size-4 cursor-pointer accent-[var(--primary)]"
      />
    </span>
  );
}

/**
 * versions: [{ version, comment, publishedBy, publishedAt, changes }], newest first
 * comparison: { from, to, changes } of the picked A and B, or null
 * actions: bound server actions { discard, rebase, restore(version, replace) }
 */
export function VersionsView({ versions, draft, liveVersion, a, b, comparison, canEdit, reviewHref, actions }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(null);
  // Comparing needs two versions
  const comparable = versions.length > 1;

  const pickVersions = (next) => {
    const params = new URLSearchParams({ a: String(next.a), b: String(next.b) });
    startTransition(() => router.replace(`${pathname}?${params}`, { scroll: false }));
  };

  const restore = (version, replace) =>
    startTransition(async () => {
      const result = await actions.restore(version, replace);
      setConfirming(null);
      if (result.error) toast.add({ title: result.error, type: 'error' });
      else toast.add({ title: `v${version} restored into the draft`, description: 'Review it on Parameters and publish.' });
    });

  return (
    <div className="flex flex-col gap-4">
      <DraftBar draft={draft} liveVersion={liveVersion} canEdit={canEdit} actions={actions} reviewHref={reviewHref} />

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-0.5 px-4 py-3">
          <span className="text-sm font-semibold">Versions</span>
          <span className="text-xs text-muted-foreground">{comparable ? 'Pick A and B to compare any two versions' : 'Comparing is possible from the second published version'}</span>
        </div>

        {versions.length === 0 ? (
          <div className="border-t border-border px-4 py-5 text-[0.8125rem] text-muted-foreground">
            Nothing is published yet. Edit a parameter and publish the draft.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className={cn('min-w-[56rem] transition-opacity', pending && 'opacity-60')}>
              <div className={cn(GRID, 'h-8 border-t border-border bg-muted text-xs font-medium text-muted-foreground')}>
                <span className="text-center">{comparable && 'A'}</span>
                <span className="text-center">{comparable && 'B'}</span>
                <span>Version</span>
                <span>Published</span>
                <span>By</span>
                <span>Comment</span>
                <span />
              </div>
              {versions.map((version) => {
                const live = version.version === liveVersion;
                return (
                  <div key={version.version} className={cn(GRID, 'min-h-10 border-t border-border py-1.5 text-[0.8125rem]')}>
                    {comparable ? (
                        <>
                          <Radio checked={a === version.version} label={`Compare from v${version.version}`} onChange={() => pickVersions({ a: version.version, b })} />
                          <Radio checked={b === version.version} label={`Compare to v${version.version}`} onChange={() => pickVersions({ a, b: version.version })} />
                        </>
                      ) : (
                        <>
                          <span />
                          <span />
                        </>
                      )}
                    <span className="font-mono text-xs font-semibold">v{version.version}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{timeFormat.format(new Date(version.publishedAt))}</span>
                    <span className="truncate text-xs">{version.publishedBy ?? 'script'}</span>
                    <span className="truncate" title={`${version.changes} change${version.changes === 1 ? '' : 's'}`}>
                      {version.comment ?? <span className="text-muted-foreground">—</span>}
                    </span>
                    <span className="flex justify-end">
                      {live ? (
                        <span className="inline-flex h-5 items-center rounded-[0.3125rem] bg-success-soft px-1.5 text-xs font-medium text-success">
                          live
                        </span>
                      ) : (
                        canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pending}
                            onClick={() => (draft ? setConfirming(version.version) : restore(version.version, false))}
                          >
                            Restore into draft
                          </Button>
                        )
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {comparison && (
        <section className={cn('overflow-hidden rounded-lg border border-border bg-card transition-opacity', pending && 'opacity-60')}>
          <div className="px-4 py-3 text-sm font-semibold">
            v{comparison.from} → v{comparison.to}
          </div>
          {comparison.changes.length === 0 ? (
            <div className="border-t border-border px-4 py-3 text-[0.8125rem] text-muted-foreground">No differences.</div>
          ) : (
            comparison.changes.map((change) => <ChangeRow key={change.path} change={change} />)
          )}
        </section>
      )}

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent
          title={`Replace the draft with v${confirming}?`}
          description="The current draft and its changes are lost. Experiments and the holdout stay as they are live."
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirming(null)}>
                Keep the draft
              </Button>
              <Button variant="destructive" disabled={pending} onClick={() => restore(confirming, true)}>
                Replace the draft
              </Button>
            </>
          }
        >
          Restoring puts the parameters, values and rules of v{confirming} into the draft. Nothing reaches users until you
          publish it.
        </DialogContent>
      </Dialog>
    </div>
  );
}
