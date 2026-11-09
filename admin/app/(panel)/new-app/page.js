import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/page-header';
import { requireSession } from '@/lib/session';
import { createApp } from './actions';
import { NewAppForm } from './new-app-form';

export const metadata = { title: 'New app · Renvix Apps Platform' };

export default async function NewAppPage() {
  const session = await requireSession();
  if (!session.roles.some((grant) => grant.role === 'owner' && grant.appId === null)) {
    notFound();
  }

  return (
    <>
      <PageHeader title="New app" subtitle="Create the app, then set up its platforms" />
      <PageBody>
        <div className="max-w-xl">
          <NewAppForm action={createApp} />
        </div>
      </PageBody>
    </>
  );
}