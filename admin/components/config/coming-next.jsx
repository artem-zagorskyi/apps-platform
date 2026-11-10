import { Hammer } from 'lucide-react';
import { EmptyState } from '@/components/data/states';

// A tab of Config & experiments that is not built yet
export function ComingNext({ title, children }) {
  return (
    <EmptyState icon={Hammer} title={title}>
      {children}
    </EmptyState>
  );
}
