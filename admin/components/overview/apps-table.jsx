import Link from 'next/link';
import { Check, CircleAlert } from 'lucide-react';
import { AppAvatar } from '@/components/shell/app-avatar';
import { Card, CardHeader } from '@/components/ui/card';
import { change, money, num, pct } from '@/lib/overview-format';
import { cn } from '@/lib/utils';
import { Delta } from './metric-tile';
import { Sparkline } from './sparkline';

const GRID = 'grid grid-cols-[minmax(12rem,1.6fr)_minmax(9rem,1.1fr)_6rem_6.5rem_6.5rem_7rem_5rem_6.5rem] items-center gap-3 px-4';

function Stacked({ value, delta }) {
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="tabular-nums">{value}</span>
      {delta !== undefined && (delta ? <Delta change={delta} className="text-[0.6875rem]" /> : <span className="text-[0.6875rem] text-muted-foreground">—</span>)}
    </span>
  );
}

const revenueOf = (metrics) => metrics.revenue7d[0] ?? null;
const sum = (apps, pick) => apps.reduce((total, app) => total + (pick(app) ?? 0), 0);

/** All apps: one row per app with the main numbers of the last 7 days */
export function AppsTable({ apps }) {
  const active = apps.filter((app) => app.status === 'active');
  const cohort = (key) => sum(active, (app) => app.metrics[key].cohort);
  const weighted = (key) =>
    cohort(key) ? sum(active, (app) => (app.metrics[key].value ?? 0) * app.metrics[key].cohort) / cohort(key) : null;
  const currencies = new Set(active.flatMap((app) => app.metrics.revenue7d.map((row) => row.currency)));
  const currency = currencies.size === 1 ? [...currencies][0] : null;
  const mau = sum(active, (app) => app.metrics.mau.value);

  return (
    <Card>
      <CardHeader title="Apps" description="Last 7 days vs previous 7 days · Technical (all users)" />
      <div className="overflow-x-auto">
        <div className="min-w-[56rem]">
          <div className={cn(GRID, 'h-8 border-t border-border bg-muted text-xs font-medium text-muted-foreground')}>
            <span>App</span>
            <span className="text-right">DAU</span>
            <span className="text-right">MAU</span>
            <span className="text-right">D1 / D7</span>
            <span className="text-right">Subscribers</span>
            <span className="text-right">Revenue 7 d</span>
            <span className="text-right">Consent</span>
            <span className="text-right">Attention</span>
          </div>

          {apps.map((app) => {
            const m = app.metrics;
            const disabled = app.status === 'disabled';
            const revenue = revenueOf(m);
            const issues = app.attention.length;
            const critical = app.attention.some((item) => item.severity === 'critical');
            return (
              <Link
                key={app.id}
                href={`/apps/${encodeURIComponent(app.slug)}/overview`}
                className={cn(GRID, 'min-h-12 border-t border-border py-1.5 text-[0.8125rem] hover:bg-accent')}
              >
                <span className={cn('flex min-w-0 items-center gap-2.5', disabled && 'opacity-60')}>
                  <AppAvatar app={app} size={22} />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate font-medium">{app.name}</span>
                    <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">{app.slug}</span>
                  </span>
                  {disabled && (
                    <span className="rounded-[0.3125rem] border border-border px-1.5 text-[0.6875rem] text-muted-foreground">
                      disabled
                    </span>
                  )}
                </span>
                {disabled ? (
                  Array.from({ length: 7 }, (_, index) => (
                    <span key={index} className="text-right text-muted-foreground">
                      —
                    </span>
                  ))
                ) : (
                  <>
                    <span className="flex items-center justify-end gap-3">
                      <Sparkline values={m.dau.spark} width={56} height={22} />
                      <Stacked value={num(m.dau.value)} delta={change(m.dau)} />
                    </span>
                    <Stacked value={num(m.mau.value)} delta={change(m.mau)} />
                    <span className="text-right tabular-nums">
                      {pct(m.retentionD1.value)} / {pct(m.retentionD7.value)}
                    </span>
                    <Stacked value={num(m.subscribers.value)} />
                    <Stacked
                      value={revenue ? money(revenue.value, revenue.currency) : money(0, 'EUR')}
                      delta={revenue ? change(revenue) : null}
                    />
                    <span className="text-right tabular-nums">{pct(m.consentRate.value)}</span>
                    <span className="flex justify-end">
                      {issues === 0 ? (
                        <span className="inline-flex h-[1.375rem] items-center gap-1 rounded-[0.3125rem] bg-success-soft px-2 text-xs font-medium text-success">
                          <Check className="size-3" strokeWidth={2.6} />
                          All good
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'inline-flex h-[1.375rem] items-center gap-1 rounded-[0.3125rem] px-2 text-xs font-medium tabular-nums',
                            critical ? 'bg-destructive-soft text-destructive' : 'bg-warning-soft text-warning',
                          )}
                        >
                          <CircleAlert className="size-3" />
                          {issues}
                        </span>
                      )}
                    </span>
                  </>
                )}
              </Link>
            );
          })}

          <div className={cn(GRID, 'h-11 border-t border-border bg-muted text-[0.8125rem] font-semibold tabular-nums')}>
            <span>Total</span>
            <span className="text-right">{num(sum(active, (app) => app.metrics.dau.value))}</span>
            <span className="text-right">{num(mau)}</span>
            <span className="text-right">
              {pct(weighted('retentionD1'))} / {pct(weighted('retentionD7'))}
            </span>
            <span className="text-right">{num(sum(active, (app) => app.metrics.subscribers.value))}</span>
            <span className="text-right">
              {currency
                ? money(sum(active, (app) => app.metrics.revenue7d[0]?.value), currency)
                : currencies.size === 0
                  ? money(0, 'EUR')
                  : 'mixed'}
            </span>
            <span className="text-right">
              {pct(mau ? sum(active, (app) => (app.metrics.consentRate.value ?? 0) * app.metrics.mau.value) / mau : null)}
            </span>
            <span className="text-right">{sum(active, (app) => app.attention.length)}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
