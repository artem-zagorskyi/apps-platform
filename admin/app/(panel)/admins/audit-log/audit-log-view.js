'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { ArrowDown, Search, X } from 'lucide-react';
import { AdminAvatar } from '@/components/data/admin-avatar';
import { DataTable } from '@/components/data/data-table';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { appColor } from '@/lib/app-look';
import {
  ACTION_CLASS,
  actionKind,
  changedFields,
  detailFields,
  fullTime,
  objectLabel,
  relativeTime,
} from '@/lib/audit-format';
import { cn } from '@/lib/utils';

// "All" in the selects; not sent to the server
const ANY = 'all';
// Entries of no app: sign-ins, admins, scripts
const PLATFORM = '_platform';
const PLATFORM_COLOR = 'oklch(0.6 0.01 260)';
const PERIODS = [
  { value: '30d', label: 'Last 30 days' },
  { value: '7d', label: 'Last 7 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

const count = (n) => n.toLocaleString('en-US');

function AppCell({ app }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-[0.125rem]"
        style={{ background: app ? appColor(app) : PLATFORM_COLOR }}
      />
      <span className="truncate">{app?.name ?? 'Platform'}</span>
    </span>
  );
}

function Details({ entry }) {
  const changes = changedFields(entry);
  const details = detailFields(entry);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="tabular-nums">{fullTime(entry.createdAt)} (Europe/Berlin)</span>
        <span className="font-mono">{entry.id}</span>
        {entry.ip && <span className="font-mono">{entry.ip}</span>}
      </div>
      {entry.reason && <p className="whitespace-normal text-[0.8125rem] text-pretty">“{entry.reason}”</p>}

      {changes.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {changes.map(({ field, from, to }) => (
            <div
              key={field}
              className="grid grid-cols-[11.25rem_auto_0.875rem_auto] items-center justify-start gap-2 font-mono text-xs leading-relaxed"
            >
              <span className="truncate text-muted-foreground">{field}</span>
              {from === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className="whitespace-normal break-all rounded bg-destructive-soft px-1.5 line-through decoration-destructive">
                  {from}
                </span>
              )}
              <span className="text-muted-foreground">→</span>
              {to === null ? (
                <span className="text-muted-foreground">removed</span>
              ) : (
                <span className="whitespace-normal break-all rounded bg-success-soft px-1.5">{to}</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">
          {actionKind(entry.action) === 'read' ? 'Read-only action, no fields changed.' : 'No field changes recorded.'}
        </span>
      )}

      {details.length > 0 && (
        <div className="flex flex-col gap-1">
          {details.map(({ field, value }) => (
            <div key={field} className="grid grid-cols-[11.25rem_minmax(0,1fr)] gap-2 font-mono text-xs leading-relaxed">
              <span className="truncate text-muted-foreground">{field}</span>
              <span className="whitespace-normal break-all">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const COLUMNS = [
  {
    key: 'time',
    header: (
      <span className="inline-flex items-center gap-1">
        Time
        <ArrowDown className="size-3" strokeWidth={2.4} />
      </span>
    ),
    width: '7rem',
    cell: (entry) => (
      <span title={fullTime(entry.createdAt)} suppressHydrationWarning className="text-xs text-muted-foreground">
        {relativeTime(entry.createdAt)}
      </span>
    ),
  },
  {
    key: 'admin',
    header: 'Admin',
    width: '10.625rem',
    cell: (entry) => (
      <span className="flex min-w-0 items-center gap-2">
        <AdminAvatar email={entry.admin?.email} />
        <span className={cn('truncate text-xs', !entry.admin && 'text-muted-foreground')}>
          {entry.admin?.email ?? 'script'}
        </span>
      </span>
    ),
  },
  {
    key: 'action',
    header: 'Action',
    width: '11.25rem',
    cell: (entry) => (
      <span
        className={cn(
          'inline-flex h-[1.375rem] max-w-full items-center truncate rounded-[0.3125rem] border px-[0.4375rem] font-mono text-xs font-medium',
          ACTION_CLASS[actionKind(entry.action)],
        )}
      >
        {entry.action}
      </span>
    ),
  },
  { key: 'app', header: 'App', width: '7.5rem', cell: (entry) => <AppCell app={entry.app} /> },
  {
    key: 'object',
    header: 'Object',
    width: 'minmax(11.25rem,1fr)',
    cell: (entry) => {
      const label = objectLabel(entry);
      return label ? (
        <span title={entry.targetId ?? undefined} className="font-mono text-xs font-medium">
          {label}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  },
  {
    key: 'reason',
    header: 'Reason',
    width: 'minmax(12.5rem,1.2fr)',
    cell: (entry) =>
      entry.reason ? <span title={entry.reason}>{entry.reason}</span> : <span className="text-muted-foreground">—</span>,
  },
];

/**
 * log: { entries, total, page, limit }
 * filters: { admins: [{ id, email }], actions: [string], apps: [{ slug, name, status }] }
 * query: the filters in the URL: { q, admin, action, app, period, page }
 */
export function AuditLogView({ log, filters, query }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query.q ?? '');

  const period = query.period ?? '30d';
  const periodLabel = PERIODS.find((item) => item.value === period)?.label ?? PERIODS[0].label;
  const filtered = Boolean(query.q || query.admin || query.action || query.app);

  function go(changes) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...query, page: undefined, ...changes })) {
      if (value && value !== ANY && !(key === 'period' && value === '30d')) next.set(key, String(value));
    }
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  // Search as you type, after a short pause
  useEffect(() => {
    const text = search.trim();
    if (text === (query.q ?? '')) return;
    const timer = setTimeout(() => go({ q: text }), 400);
    return () => clearTimeout(timer);
    // go changes on every render; the query decides
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, query.q]);

  function reset() {
    setSearch('');
    go({ q: undefined, admin: undefined, action: undefined, app: undefined });
  }

  const from = log.total === 0 ? 0 : (log.page - 1) * log.limit + 1;
  const to = Math.min(log.page * log.limit, log.total);
  const any = { value: ANY, label: 'All' };

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <label className="flex h-8 max-w-80 flex-[1_1_15rem] items-center gap-2 rounded-md border border-input bg-card px-2.5 focus-within:border-ring">
          <Search className="size-[0.9375rem] shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search object or reason"
            aria-label="Search object or reason"
            className="min-w-0 flex-1 bg-transparent text-[0.8125rem] outline-none placeholder:text-muted-foreground"
          />
        </label>
        <Select
          label="Admin"
          value={query.admin ?? ANY}
          onValueChange={(value) => go({ admin: value })}
          items={[any, ...filters.admins.map((admin) => ({ value: admin.id, label: admin.email }))]}
        />
        <Select
          label="Action"
          mono
          value={query.action ?? ANY}
          onValueChange={(value) => go({ action: value })}
          items={[any, ...filters.actions.map((action) => ({ value: action, label: action }))]}
        />
        <Select
          label="App"
          value={query.app ?? ANY}
          onValueChange={(value) => go({ app: value })}
          items={[
            any,
            ...filters.apps.map((app) => ({ value: app.slug, label: app.name })),
            { value: PLATFORM, label: 'Platform' },
          ]}
        />
        <Select label="Period" value={period} onValueChange={(value) => go({ period: value })} items={PERIODS} />
        {filtered && (
          <Button variant="muted" onClick={reset}>
            <X />
            Reset
          </Button>
        )}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {count(log.total)} {filtered ? 'matching' : log.total === 1 ? 'action' : 'actions'} ·{' '}
          {periodLabel.toLowerCase()}
        </span>
      </div>

      <div className={cn('transition-opacity', pending && 'opacity-60')}>
        <DataTable
          columns={COLUMNS}
          rows={log.entries}
          expandable={(entry) => <Details entry={entry} />}
          minWidth="61.25rem"
          rowHeight="2.375rem"
          empty={
            <div className="flex flex-col items-center gap-1.5 border-t border-border px-4 pb-11 pt-10 text-center">
              <span className="text-[0.8125rem] font-semibold">No actions match these filters</span>
              <span className="text-[0.8125rem] text-muted-foreground">
                Nothing for this search in {periodLabel.toLowerCase()}. Try a wider period or clear the filters.
              </span>
              {(filtered || period !== 'all') && (
                <Button variant="outline" size="sm" className="mt-1.5" onClick={filtered ? reset : () => go({ period: 'all' })}>
                  {filtered ? 'Reset filters' : 'Show all time'}
                </Button>
              )}
            </div>
          }
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
        <span>{log.total === 0 ? 'No actions' : `Showing ${count(from)}–${count(to)} of ${count(log.total)}`}</span>
        <div className="flex gap-1.5">
          <Button variant="outline" size="xs" disabled={log.page <= 1} onClick={() => go({ page: log.page - 1 })}>
            Previous
          </Button>
          <Button variant="outline" size="xs" disabled={to >= log.total} onClick={() => go({ page: log.page + 1 })}>
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}
