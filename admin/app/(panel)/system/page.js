import { SectionPlaceholder } from '@/components/section-placeholder';

export const metadata = { title: 'System · Renvix Apps Platform' };

export default function SystemPage() {
  return (
    <SectionPlaceholder title="System" subtitle="Shared by every app">
      Server state, the job queue, webhooks and store notifications come in a later step of the admin plan.
    </SectionPlaceholder>
  );
}