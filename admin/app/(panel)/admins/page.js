import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DataTable } from '@/components/data/data-table';
import { EmptyRow, EmptyState } from '@/components/data/states';
import { PageBody, PageHeader } from '@/components/shell/page-header';
import { Time } from '@/components/time';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { AdminApiError, adminApi } from '@/lib/admin-api';

// "Any" in the selects; dropped from the query
const ANY = 'any';
const FILTERS = ['app', 'admin', 'action', 'from', 'to'];

const COLUMNS = [
  { key: 'time', header: 'Time', width: '9.5rem' },
  { key: 'admin', header: 'Admin', width: 'minmax(8.75rem,1fr)' },
  { key: 'action', header: 'Action', width: 'minmax(10rem,1fr)' },
  { key: 'app', header: 'App', width: '8rem' },
  { key: 'change', header: 'Target and reason', width: 'minmax(12rem,1.6fr)' },
];

function queryOf(params, extra = {}) {
  const query = new URLSearchParams();
  for (const key of FILTERS) {
    const value = params[key];
    if (typeof value === 'string' && value && value !== ANY) query.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value);
  return query.toString();
}

async function load(params) {
  try {
    const [log, filters] = await Promise.all([
      adminApi(`/audit-log?${queryOf(params, { before: params.before })}`),
      adminApi('/audit-log/filters'),
    ]);
    return { log, filters };
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) redirect('/login');
    if (err instanceof AdminApiError && err.status === 403) return { forbidden: true };
    throw err;
  }
}

function Change({ entry }) {
  const data = { before: entry.before, after: entry.after, details: entry.details };
  const hasData = Object.values(data).some((value) => value !== null && value !== undefined);
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
      {entry.targetType && (
        <span className="truncate font-mono text-xs text-muted-foreground" title={entry.targetId ?? undefined}>
          {entry.targetType}
          {entry.targetId ? ` · ${entry.targetId}` : ''}
        </span>
      )}
      {entry.reason && <span className="text-xs">“{entry.reason}”</span>}
      {hasData && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Details</summary>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-[0.6875rem]">
            {JSON.stringify(data, (_key, value) => (value === null ? undefined : value), 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

export default async function AuditLogPage({ searchParams }) {
  const params = await searchParams;
  const { log, filters, forbidden } = await load(params);

  if (forbidden) {
    return (
      <>
        <PageHeader title="Admins & audit log" />
        <PageBody>
          <EmptyState title="Owners only">
            The audit log shows sign-ins and views of user data, so only owners of every app can read it.
          </EmptyState>
        </PageBody>
      </>
    );
  }

  const any = (label) => ({ value: ANY, label });
  const rows = log.entries.map((entry) => ({
    id: entry.id,
    time: (
      <span className="text-xs tabular-nums" title={entry.ip ?? undefined}>
        <Time value={entry.createdAt} />
      </span>
    ),
    admin: <span className="truncate text-xs">{entry.admin?.email ?? 'script'}</span>,
    action: <span className="truncate font-mono text-xs font-medium">{entry.action}</span>,
    app: <span className="truncate text-xs">{entry.app?.name ?? '—'}</span>,
    change: <Change entry={entry} />,
  }));
  const filtered = FILTERS.some((key) => params[key] && params[key] !== ANY);
  const newest = !params.before;

  return (
    <>
      <PageHeader title="Admins & audit log" subtitle="Who did what, when and why. Entries cannot be changed." />
      <PageBody>
        <div className="flex flex-col gap-4">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <Select
              name="app"
              aria-label="App"
              defaultValue={params.app ?? ANY}
              items={[any('Any app'), ...filters.apps.map((app) => ({ value: app.slug, label: app.name }))]}
            />
            <Select
              name="admin"
              aria-label="Admin"
              defaultValue={params.admin ?? ANY}
              items={[any('Any admin'), ...filters.admins.map((admin) => ({ value: admin.id, label: admin.email }))]}
            />
            <Select
              name="action"
              aria-label="Action"
              defaultValue={params.action ?? ANY}
              items={[any('Any action'), ...filters.actions.map((action) => ({ value: action, label: action }))]}
            />
            <Input type="date" name="from" aria-label="From (UTC)" defaultValue={params.from} className="w-36" />
            <Input type="date" name="to" aria-label="To (UTC)" defaultValue={params.to} className="w-36" />
            <Button type="submit" variant="outline">
              Apply
            </Button>
            {filtered && (
              <Link href="/admins" className="px-2 text-xs text-muted-foreground underline">
                Reset
              </Link>
            )}
          </form>

          <DataTable
            columns={COLUMNS}
            rows={rows}
            minWidth="47.5rem"
            empty={<EmptyRow>{filtered ? 'Nothing matches these filters.' : 'No entries yet.'}</EmptyRow>}
          />

          <div className="flex items-center justify-between text-xs">
            {newest ? (
              <span />
            ) : (
              <Link href={`/admins?${queryOf(params)}`} className="text-muted-foreground underline">
                ← Newest
              </Link>
            )}
            {log.nextBefore && (
              <Link href={`/admins?${queryOf(params, { before: log.nextBefore })}`} className="underline">
                Older →
              </Link>
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}