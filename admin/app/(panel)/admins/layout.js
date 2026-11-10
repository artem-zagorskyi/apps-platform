import { LinkTabs } from '@/components/shell/link-tabs';
import { PageBody, PageHeader } from '@/components/shell/page-header';

const TABS = [
  { href: '/admins/team', label: 'Admins' },
  { href: '/admins/audit-log', label: 'Audit log' },
];

export default function AdminsLayout({ children }) {
  return (
    <>
      <PageHeader
        title="Admins & audit log"
        subtitle="Platform · times in Europe/Berlin"
        tabs={<LinkTabs tabs={TABS} label="Admins and audit log" />}
      />
      <PageBody>{children}</PageBody>
    </>
  );
}
