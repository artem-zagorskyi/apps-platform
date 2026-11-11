'use client';

import { Info, TriangleAlert } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { CiBar } from '@/components/data/ci-bar';
import { EChart } from '@/components/data/echart';
import { HealthCard } from '@/components/data/health-card';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { liftText, metricLabel, percentText, verdictOf } from '@/lib/config-format';
import { cn } from '@/lib/utils';

const CUTS = [
  { value: 'all', label: 'All' },
  { value: 'platform', label: 'Platform' },
  { value: 'country', label: 'Country' },
  { value: 'newUsers', label: 'New vs returning' },
];
const CUT_NAMES = { android: 'Android', ios: 'iOS', new: 'New users (first 7 days)', returning: 'Returning', Other: 'Other (small ones merged)' };
// Interval scales: the smallest that fits every row
const SCALES = [0.1, 0.2, 0.3, 0.5, 1];

const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const numberFormat = new Intl.NumberFormat('en-US');
const GRID = 'grid grid-cols-[minmax(12rem,1.4fr)_6rem_6rem_5rem_minmax(12rem,1.6fr)_6.5rem] items-center gap-3 px-4';

const VERDICT_INK = { better: 'text-success', worse: 'text-destructive', unclear: 'text-foreground', none: 'text-muted-foreground' };

function Cell({ cell }) {
  if (!cell) return <span className="text-right text-muted-foreground">—</span>;
  return (
    <span className="text-right tabular-nums" title={`${numberFormat.format(cell.conversions)} of ${numberFormat.format(cell.users)} users`}>
      {percentText(cell.rate)}
    </span>
  );
}

function MetricRow({ name, tag, control, variant, lowerIsBetter, scale }) {
  const comparison = variant?.comparison ?? null;
  const verdict = verdictOf(comparison, lowerIsBetter);
  // Chance that the variant is better, whichever direction is better
  const chance = comparison ? (lowerIsBetter ? 1 - comparison.chanceToWin : comparison.chanceToWin) : null;
  return (
    <div className={cn(GRID, 'min-h-11 border-t border-border py-1.5 text-[0.8125rem]')}>
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn('truncate', tag === 'Primary' && 'font-semibold')}>{name}</span>
        {tag && (
          <span
            className={cn(
              'shrink-0 rounded-[0.25rem] px-1.5 py-0.5 text-[0.6875rem] font-medium',
              tag === 'Primary' ? 'bg-primary-soft text-primary-soft-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            {tag}
          </span>
        )}
        {lowerIsBetter && <span className="shrink-0 text-[0.6875rem] text-muted-foreground">lower is better</span>}
      </span>
      <Cell cell={control} />
      <Cell cell={variant} />
      <span className={cn('text-right font-medium tabular-nums', VERDICT_INK[verdict])}>{comparison ? liftText(comparison.lift) : '—'}</span>
      {comparison ? (
        <CiBar
          lift={comparison.lift * 100}
          lo={comparison.low * 100}
          hi={comparison.high * 100}
          range={scale * 100}
          lowerIsBetter={lowerIsBetter}
        />
      ) : (
        <span className="text-center text-xs text-muted-foreground">{control?.users ? 'not enough data' : '—'}</span>
      )}
      <span className="text-right tabular-nums">{chance === null ? '—' : `${Math.round(chance * 100)}%`}</span>
    </div>
  );
}

/**
 * experiments: [{ key, status, layer, share }] that have started
 * results: the admin API results of `experimentKey`; consentRate: share with analytics consent, or null
 */
export function ResultsView({ experiments, experimentKey, results, error, consentRate }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [cut, setCut] = useState('all');
  const others = results ? results.variants.map((v) => v.variant).filter((name) => name !== results.control) : [];
  const [picked, setPicked] = useState(null);
  const variant = others.includes(picked) ? picked : others[0];

  const experiment = experiments.find((item) => item.key === experimentKey);
  const pick = (key) => startTransition(() => router.replace(`${pathname}?experiment=${encodeURIComponent(key)}`, { scroll: false }));

  const rows = useMemo(() => {
    if (!results) return [];
    const of = (cells, name) => cells.find((cell) => cell.variant === name);
    if (cut === 'all') {
      return results.metrics.map((m) => ({
        key: m.metric,
        name: metricLabel(m.metric),
        tag: m.role === 'primary' ? 'Primary' : 'Guardrail',
        lowerIsBetter: m.lowerIsBetter,
        control: of(m.variants, results.control),
        variant: of(m.variants, variant),
      }));
    }
    return (results.cuts?.[cut] ?? []).map((group) => ({
      key: group.value,
      name: CUT_NAMES[group.value] ?? group.value,
      lowerIsBetter: false,
      control: of(group.variants, results.control),
      variant: of(group.variants, variant),
    }));
  }, [results, cut, variant]);

  const scale = useMemo(() => {
    const widest = Math.max(0, ...rows.flatMap((row) => (row.variant?.comparison ? [Math.abs(row.variant.comparison.low), Math.abs(row.variant.comparison.high)] : [])));
    return SCALES.find((value) => value >= widest) ?? SCALES.at(-1);
  }, [rows]);

  if (experiments.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card px-4 py-5 text-[0.8125rem] text-muted-foreground">
        No experiment has started yet. Results appear here once one runs.
      </section>
    );
  }

  const total = results ? results.variants.reduce((sum, v) => sum + v.users, 0) : 0;
  const crossed = results && total + results.quarantined > 0 ? results.quarantined / (total + results.quarantined) : null;
  const days = results ? Math.max(1, Math.ceil((new Date(results.until) - new Date(results.startedAt)) / 86_400_000)) : null;
  const meta = results
    ? [
        experiment?.layer,
        experiment && `${experiment.share}%`,
        results.status === 'stopped'
          ? `ran ${days} day${days === 1 ? '' : 's'}, stopped ${dateFormat.format(new Date(results.until))}`
          : `day ${days}${results.estimate ? ` of ~${results.estimate.days}` : ''}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const otherWarnings = results?.warnings.filter((warning) => !warning.startsWith('Sample ratio mismatch')) ?? [];
  const untrusted = results?.healthy === false;

  return (
    <div className={cn('flex flex-col gap-4 transition-opacity', pending && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-2.5">
        <Select
          label="Experiment"
          mono
          value={experimentKey}
          onValueChange={pick}
          items={experiments.map((item) => ({ value: item.key, label: `${item.key}${item.status === 'stopped' ? ' (stopped)' : ''}` }))}
        />
        {others.length > 1 && (
          <Select label="Variant" mono value={variant} onValueChange={setPicked} items={others.map((name) => ({ value: name, label: name }))} />
        )}
        {meta && <span className="text-[0.8125rem] text-muted-foreground">{meta}</span>}
        {consentRate !== null && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-xs">
            <Info className="size-3.5" />
            Only people who consented to analytics are counted ({percentText(consentRate, 0)})
          </span>
        )}
      </div>

      {error && (
        <section className="rounded-lg border border-destructive bg-card px-4 py-3 text-[0.8125rem] text-destructive">{error}</section>
      )}

      {results && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <HealthCard
              status={results.healthy === false ? 'fail' : results.healthy === null ? 'warn' : 'ok'}
              label="Traffic split (SRM)"
              value={
                total > 0
                  ? results.variants.map((v) => ((v.users / total) * 100).toFixed(1)).join(' / ')
                  : 'no users yet'
              }
              note={
                results.srm === null
                  ? `Expected ${results.variants.map((v) => v.weight).join(' / ')} · needs more users to judge`
                  : `Expected ${results.variants.map((v) => v.weight).join(' / ')} · p ${results.srm < 0.001 ? '< 0.001' : `= ${results.srm.toFixed(2)}`}`
              }
            />
            <HealthCard
              status={crossed !== null && crossed >= 0.01 ? 'warn' : 'ok'}
              label="Saw more than one variant"
              value={crossed === null ? '—' : percentText(crossed)}
              note={
                crossed !== null && crossed >= 0.01
                  ? 'Over 1% · usually a sign-in that merged two users, or a cached config'
                  : 'Below 1% · left out of the results'
              }
            />
          </div>

          {untrusted && (
            <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-destructive bg-destructive-soft px-4 py-3 text-[0.8125rem]">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>
                <b className="font-semibold">Do not trust these results.</b> Users did not split by the weights, so the groups are not
                comparable. Find the cause (usually a variant that crashes or skips the exposure), fix it and start a new experiment.
              </span>
            </div>
          )}

          {otherWarnings.length > 0 && (
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              {otherWarnings.map((warning) => (
                <span key={warning} className="flex items-center gap-1.5">
                  <Info className="size-3.5 shrink-0" />
                  {warning}
                </span>
              ))}
            </div>
          )}

          <div className={cn('flex flex-col gap-4', untrusted && 'opacity-45')}>
                        <section className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <h2 className="text-sm font-semibold">Exposed users, cumulative</h2>
                  <span className="text-xs text-muted-foreground">Unique people who received each variant</span>
                </div>
                <div className="flex flex-wrap gap-3 text-xs">
                  {results.variants.map((v) => (
                    <span key={v.variant} className="inline-flex items-center gap-1.5">
                      <span className="size-2.5 rounded-sm" style={{ background: `var(--chart-${colorIndex(results, v.variant) + 1})` }} />
                      <span className="font-mono">{v.variant}</span>
                      <b className="font-semibold tabular-nums">{numberFormat.format(v.users)}</b>
                    </span>
                  ))}
                </div>
              </div>
              <ExposureChart results={results} />
            </section>

            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <h2 className="text-sm font-semibold">
                  Metrics · <span className="font-mono">{variant}</span> vs <span className="font-mono">{results.control}</span>
                </h2>
                {results.cuts && <Segmented size="sm" value={cut} onValueChange={setCut} options={CUTS} />}
              </div>
              {rows.length === 0 ? (
                <div className="border-t border-border px-4 py-5 text-[0.8125rem] text-muted-foreground">
                  {results.primaryMetric ? 'No data in this cut yet.' : 'This experiment has no primary metric: only exposures are counted.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="min-w-[46rem]">
                    <div className={cn(GRID, 'h-8 border-t border-border bg-muted text-xs font-medium text-muted-foreground')}>
                      <span>{cut === 'all' ? 'Metric' : `${metricLabel(results.primaryMetric)} by ${CUTS.find((c) => c.value === cut).label.toLowerCase()}`}</span>
                      <span className="truncate text-right font-mono">{results.control}</span>
                      <span className="truncate text-right font-mono">{variant}</span>
                      <span className="text-right">Lift</span>
                      <span className="flex justify-between text-[0.6875rem]">
                        <span>−{Math.round(scale * 100)}%</span>
                        <span>95% interval</span>
                        <span>+{Math.round(scale * 100)}%</span>
                      </span>
                      <span className="text-right">Chance better</span>
                    </div>
                    {rows.map(({ key, ...row }) => (
                      <MetricRow key={key} {...row} scale={scale} />
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

// Control is grey (chart-8); the other variants take chart-1, chart-2, … in order
function colorIndex(results, variant) {
  if (variant === results.control) return 7;
  return results.variants.filter((v) => v.variant !== results.control).findIndex((v) => v.variant === variant) % 7;
}

function ExposureChart({ results }) {
  const option = useMemo(
    () => (theme) => {
      const tokens = theme._renvix.tokens;
      const { days, variants } = results.exposures;
      return {
        grid: { left: 44, right: 16, top: 12, bottom: 28 },
        tooltip: { trigger: 'axis' },
        xAxis: {
          type: 'category',
          data: days.map((day) => dateFormat.format(new Date(`${day}T00:00:00Z`))),
          boundaryGap: false,
        },
        yAxis: { type: 'value', minInterval: 1 },
        series: results.variants.map((v) => {
          const color = tokens.series[colorIndex(results, v.variant)];
          return {
            name: v.variant,
            type: 'line',
            showSymbol: days.length < 20,
            data: variants[v.variant] ?? [],
            lineStyle: { color, width: 2 },
            itemStyle: { color },
          };
        }),
      };
    },
    [results],
  );
  if (!results.exposures || results.exposures.days.length === 0) {
    return <div className="border-t border-border px-4 py-5 text-[0.8125rem] text-muted-foreground">No exposures yet.</div>;
  }
  return <EChart height={240} option={option} className="px-2 pb-2" />;
}
