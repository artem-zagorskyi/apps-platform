import { AdminAvatar } from '@/components/data/admin-avatar';
import { DataTable } from '@/components/data/data-table';
import { EmptyRow } from '@/components/data/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { fullTime, relativeTime } from '@/lib/audit-format';
import { loadOwnerData } from '../owner-data';
import { OwnersOnly } from '../owners-only';

const STATUS = {
  active: { tone: 'success', label: 'active' },
  locked: { tone: 'warning', label: 'locked' },
  disabled: { tone: 'neutral', label: 'disabled' },
};

const COLUMNS = [
  { key: 'admin', header: 'Admin', width: 'minmax(13rem,1.4fr)' },
  { key: 'roles', header: 'Roles', width: 'minmax(13rem,1.6fr)' },
  { key: 'status', header: 'Status', width: '6.5rem' },
  { key: 'lastLogin', header: 'Last sign-in', width: '8.5rem' },
  { key: 'sessions', header: 'Sessions', width: '5.5rem', align: 'right' },
  { key: 'created', header: 'Added', width: '7rem' },
];

function When({ value }) {
  if (!value) return <span className="text-muted-foreground">never</span>;
  return (
    <span title={fullTime(value)} className="text-xs text-muted-foreground">
      {relativeTime(value)}
    </span>
  );
}

export default async function AdminsTeamPage() {
  const data = await loadOwnerData(['/admins']);
  if (!data) return <OwnersOnly />;
  const [{ admins }] = data;

  const rows = admins.map((admin) => ({
    id: admin.id,
    admin: (
      <span className="flex min-w-0 items-center gap-2">
        <AdminAvatar email={admin.email} />
        <span className="truncate">{admin.email}</span>
      </span>
    ),
    roles: (
      <span className="flex flex-wrap gap-1">
        {admin.roles.map((grant) => (
          <Badge key={`${grant.role}:${grant.app?.slug ?? 'all'}`} tone={grant.role === 'owner' ? 'primary' : 'outline'}>
            <span className="font-mono">{grant.role}</span>
            <span className="opacity-70">· {grant.app?.name ?? 'All apps'}</span>
          </Badge>
        ))}
      </span>
    ),
    status: (
      <Badge tone={STATUS[admin.status].tone} dot>
        {STATUS[admin.status].label}
      </Badge>
    ),
    lastLogin: <When value={admin.lastLoginAt} />,
    sessions: <span className={admin.activeSessions === 0 ? 'text-muted-foreground' : undefined}>{admin.activeSessions}</span>,
    created: <When value={admin.createdAt} />,
  }));

  return (
    <Card>
      <CardHeader
        title="Admins"
        description="People who can sign in to this panel. For now admins are added with pnpm admin:create; inviting and changing roles comes with the roles step."
      />
      <DataTable
        columns={COLUMNS}
        rows={rows}
        minWidth="48rem"
        rowHeight="2.75rem"
        empty={<EmptyRow>No admins yet.</EmptyRow>}
      />
    </Card>
  );
}
