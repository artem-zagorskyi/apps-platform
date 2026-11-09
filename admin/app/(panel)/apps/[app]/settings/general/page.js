import { ActionForm } from '@/components/action-form';
import { Time } from '@/components/time';
import { Input } from '@/components/ui/input';
import { getApp } from '@/lib/apps';
import { renameApp, setAppStatus } from '../actions';
import { StatusBadge } from '@/components/data/status-badge';

export default async function GeneralSettingsPage({ params }) {
  const { app: slug } = await params;
  const { app } = await getApp(slug);

  return (
    <div className="grid gap-8">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Slug</dt>
        <dd className="font-mono">{app.slug}</dd>
        <dt className="text-muted-foreground">App ID</dt>
        <dd className="font-mono">{app.id}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          <StatusBadge status={app.status} />
        </dd>
        <dt className="text-muted-foreground">Created</dt>
        <dd>
          <Time value={app.createdAt} />
        </dd>
      </dl>

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Name</h2>
        <ActionForm action={renameApp.bind(null, app.slug)} submitLabel="Rename">
          <Input name="name" aria-label="Name" defaultValue={app.name} required maxLength={80} />
        </ActionForm>
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Status</h2>
        {app.status === 'active' ? (
          <ActionForm action={setAppStatus.bind(null, app.slug, 'disabled')} submitLabel="Disable app" variant="destructive">
            <p className="text-sm text-muted-foreground">
              Nothing is deleted, and the app can be enabled again. The reason goes to the audit log.
            </p>
            <Input name="reason" aria-label="Reason" placeholder="Reason" required maxLength={500} />
          </ActionForm>
        ) : (
          <ActionForm action={setAppStatus.bind(null, app.slug, 'active')} submitLabel="Enable app">
            <Input name="reason" aria-label="Reason" placeholder="Reason (optional)" maxLength={500} />
          </ActionForm>
        )}
      </section>
    </div>
  );
}