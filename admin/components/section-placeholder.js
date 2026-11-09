import { Construction } from 'lucide-react';
import { EmptyState } from '@/components/data/states';
import { PageBody, PageHeader } from '@/components/shell/page-header';

// A whole page for sections that are not built yet, or not available here
export function SectionPlaceholder({ title, subtitle, emptyTitle = 'Not built yet', icon = Construction, children }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <PageBody>
        <EmptyState icon={icon} title={emptyTitle}>
          {children}
        </EmptyState>
      </PageBody>
    </>
  );
}