import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requireSession } from '@/lib/session';
import { createApp } from './actions';

export const metadata = { title: 'New app · Apps Platform' };

export default async function NewAppPage() {
  const session = await requireSession();
  if (!session.roles.some((grant) => grant.role === 'owner' && grant.appId === null)) {
    notFound();
  }

  return (
    <div className="grid max-w-md gap-6">
      <h1 className="text-2xl font-semibold">New app</h1>
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
  );
}