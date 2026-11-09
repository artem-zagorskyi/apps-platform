import { ConfirmActionButton } from '@/components/confirm-action-button';
import { DataTable } from '@/components/data/data-table';
import { PageBody, PageHeader } from '@/components/shell/page-header';
import { Time } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { adminApi } from '@/lib/admin-api';
import { requireSession } from '@/lib/session';
import { revokeOtherSessions } from './actions';

export const metadata = { title: 'My account · Renvix Apps Platform' };

const ROLE_LABELS = { owner: 'Owner', product: 'Product', support: 'Support', viewer: 'Viewer' };

function describeRole({ role, appId }) {
  return `${ROLE_LABELS[role] ?? role} (${appId ? 'one app' : 'all apps'})`;
}

// "Chrome on Linux" from a user agent string; the full string stays in the tooltip
function describeBrowser(userAgent) {
  if (!userAgent) {
    return 'Unknown browser';
  }
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Mac OS X/.test(userAgent)
        ? 'macOS'
        : /Android/.test(userAgent)
          ? 'Android'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return os ? `${browser} on ${os}` : browser;
}

// Cells are built here, on the server, so the client table receives no functions
const COLUMNS = [
  { key: 'browser', header: 'Browser', width: 'minmax(220px,1.6fr)' },
  { key: 'ip', header: 'IP', width: '150px', mono: true },
  { key: 'createdAt', header: 'Signed in', width: 'minmax(150px,1fr)' },
  { key: 'lastUsedAt', header: 'Last active', width: 'minmax(150px,1fr)' },
  { key: 'expiresAt', header: 'Ends at the latest', width: 'minmax(150px,1fr)' },
];

export default async function AccountPage() {
  const session = await requireSession();
  const { sessions } = await adminApi('/auth/sessions');

  const rows = sessions.map((item) => ({
    id: item.id,
    browser: (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate" title={item.userAgent ?? undefined}>
          {describeBrowser(item.userAgent)}
        </span>
        {item.current && (
          <Badge tone="primary" size="sm">
            This one
          </Badge>
        )}
      </span>
    ),
    ip: item.ip ?? '—',
    createdAt: <Time value={item.createdAt} />,
    lastUsedAt: <Time value={item.lastUsedAt} />,
    expiresAt: <Time value={item.expiresAt} />,
  }));

  return (
    <>
      <PageHeader title="My account" subtitle={`${session.email} · ${session.roles.map(describeRole).join(', ')}`} />
      <PageBody>
        <Card className="max-w-5xl">
          <CardHeader
            title="Sessions"
            description="Browsers where you are signed in. A session ends after 30 minutes without activity or 12 hours after sign-in."
            actions={
              <ConfirmActionButton
                action={revokeOtherSessions}
                label="Sign out other sessions"
                variant="outline"
                disabled={sessions.length < 2}
                title="Sign out other sessions?"
                description="Every other browser where you are signed in will have to sign in again. This one stays."
                confirmLabel="Sign out others"
                pendingLabel="Signing out…"
                successMessage="Other sessions signed out"
              />
            }
          />
          <DataTable columns={COLUMNS} rows={rows} minWidth={760} />
        </Card>
      </PageBody>
    </>
  );
}