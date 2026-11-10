import { ShieldCheck } from 'lucide-react';
import { EmptyState } from '@/components/data/states';

export function OwnersOnly() {
  return (
    <EmptyState icon={ShieldCheck} title="Owners only">
      The audit log and the admins list show sign-ins and views of user data, so only owners of every app can open
      them.
    </EmptyState>
  );
}
