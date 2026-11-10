import { cn } from '@/lib/utils';

const DOT = {
  configured: 'bg-success',
  not_configured: 'bg-warning',
  optional: 'border border-muted-foreground/50 bg-transparent',
  error: 'bg-destructive',
};

export const STATUS_TEXT = {
  configured: 'Configured',
  not_configured: 'Needed before release',
  optional: 'Optional',
  error: 'Needs attention',
};

export function StatusDot({ status, className }) {
  return <span aria-hidden="true" className={cn('inline-block size-1.5 shrink-0 rounded-full', DOT[status], className)} />;
}

/** Tab title with its state: a dot, the hint on hover, the text for screen readers */
export function TabLabel({ label, state }) {
  if (!state) return label;
  return (
    <span className="inline-flex items-center gap-1.5" title={`${STATUS_TEXT[state.status]}: ${state.hint}`}>
      <StatusDot status={state.status} />
      {label}
      <span className="sr-only">, {STATUS_TEXT[state.status]}</span>
    </span>
  );
}