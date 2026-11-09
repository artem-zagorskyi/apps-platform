import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Time } from '@/components/time';
import { adminApi } from '@/lib/admin-api';
import { requireSession } from '@/lib/session';
import { revokeOtherSessions } from './actions';
import { PageBody, PageHeader } from '@/components/shell/page-header';

export const metadata = { title: 'My account · Apps Platform' };

function describeRole({ role, appId }) {
  return appId ? `${role} (one app)` : `${role} (all apps)`;
}

export default async function AccountPage() {
  const session = await requireSession();
  const { sessions } = await adminApi('/auth/sessions');

  return (
    <>
      <PageHeader title="My account" subtitle={`${session.email} · ${session.roles.map(describeRole).join(', ')}`} />
      <PageBody>
        <section className="grid max-w-4xl gap-3">
            <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-medium">Sessions</h2>
            <form action={revokeOtherSessions}>
              <Button type="submit" variant="outline" size="sm" disabled={sessions.length < 2}>
                Sign out other sessions
              </Button>
            </form>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Browser</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Signed in</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead>Ends at the latest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-xs">
                    <div className="flex items-center gap-2">
                      <span className="truncate" title={item.userAgent ?? undefined}>
                        {item.userAgent ?? 'Unknown'}
                      </span>
                      {item.current && <Badge tone="primary" size="sm">This one</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{item.ip ?? '—'}</TableCell>
                  <TableCell><Time value={item.createdAt} /></TableCell>
                  <TableCell><Time value={item.lastUsedAt} /></TableCell>
                  <TableCell><Time value={item.expiresAt} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-sm text-muted-foreground">
            A session ends after 30 minutes without activity or 12 hours after sign-in.
          </p>
        </section>
      </PageBody>
    </>
  );
}