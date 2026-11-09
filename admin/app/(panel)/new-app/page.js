import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requireSession } from '@/lib/session';
import { createApp } from './actions';
import { PageBody, PageHeader } from '@/components/shell/page-header';

export const metadata = { title: 'New app · Apps Platform' };

export default async function NewAppPage() {
  const session = await requireSession();
  if (!session.roles.some((grant) => grant.role === 'owner' && grant.appId === null)) {
    notFound();
  }

  return (
    <>
      <PageHeader title="New app" subtitle="Create the app, then set up its platforms" />
      <PageBody>
        <div className="max-w-md">
          <ActionForm action={createApp} submitLabel="Create app">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required maxLength={80} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="slug">Slug</Label>
              <Input id="slug" name="slug" required minLength={3} maxLength={40} className="font-mono" placeholder="habit-tracker" />
              <p className="text-sm text-muted-foreground">
                Lowercase letters, digits and dashes. Used in URLs and scripts; cannot be changed later.
              </p>
            </div>
          </ActionForm>
        </div>
      </PageBody>
    </>
  );
}