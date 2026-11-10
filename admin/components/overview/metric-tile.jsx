import { ArrowDown, ArrowUp } from 'lucide-react';
import { SourceTag } from '@/components/data/source-tag';
import { cn } from '@/lib/utils';
import { Sparkline } from './sparkline';

export function Delta({ change, className }) {
  if (!change) return null;
  const Arrow = change.up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 font-semibold tabular-nums',
        change.tone === 'good' ? 'text-success' : change.tone === 'bad' ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      <Arrow className="size-3" strokeWidth={2.6} />
      {change.label}
    </span>
  );
}

/** One number of the Overview: label and source, value with a sparkline, change and comparison */
export function OverviewTile({ label, definition, source, value, spark, change, sub }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-card px-3.5 pb-3 pt-2.5">
      <div className="flex items-center justify-between gap-2">
        <span title={definition} className="truncate text-xs font-medium text-muted-foreground">
          {label}
        </span>
        {source && <SourceTag {...source} />}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-[1.375rem] font-semibold leading-[1.05] tracking-[-0.015em] tabular-nums">{value}</span>
        {spark && <Sparkline values={spark} />}
      </div>
      <span className="flex min-w-0 items-center gap-1.5 text-xs">
        <Delta change={change} />
        {sub && <span className="truncate text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}
