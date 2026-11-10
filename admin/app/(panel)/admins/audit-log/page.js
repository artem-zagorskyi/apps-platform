import { redirect } from 'next/navigation';
import { AdminApiError } from '@/lib/admin-api';
import { loadOwnerData } from '../owner-data';
import { OwnersOnly } from '../owners-only';
import { AuditLogView } from './audit-log-view';

const FILTERS = ['q', 'admin', 'action', 'app', 'period', 'page'];
const PAGE_SIZE = 25;

export default async function AuditLogPage({ searchParams }) {
  const params = await searchParams;
  const query = Object.fromEntries(
    FILTERS.flatMap((key) => (typeof params[key] === 'string' && params[key] ? [[key, params[key]]] : [])),
  );

  let data;
  try {
    data = await loadOwnerData([
      `/audit-log?${new URLSearchParams({ ...query, limit: String(PAGE_SIZE) })}`,
      '/audit-log/filters',
    ]);
  } catch (err) {
    // A hand-edited link with a filter the server rejects
    if (err instanceof AdminApiError && err.status === 400) redirect('/admins/audit-log');
    throw err;
  }
  if (!data) return <OwnersOnly />;

  const [log, filters] = data;
  return <AuditLogView log={log} filters={filters} query={query} />;
}
