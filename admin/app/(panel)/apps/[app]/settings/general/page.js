import { ActionForm } from '@/components/action-form';
import { ConfirmActionButton } from '@/components/confirm-action-button';
import { IdCopy } from '@/components/data/id-copy';
import { StatusBadge } from '@/components/data/status-badge';
import { SetupChecklist } from '@/components/settings/setup-checklist';
import { Time } from '@/components/time';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getApp, getSettingsStatus } from '@/lib/apps';
import { disableApp, enableApp, renameApp } from '../actions';

export default async function GeneralSettingsPage({ params }) {
  const { app: slug } = await params;
  const [{ app }, status] = await Promise.all([getApp(slug), getSettingsStatus(slug)]);
  const active = app.status === 'active';

  return (
    <div className="flex flex-col gap-4">
      <SetupChecklist slug={app.slug} tabs={status.tabs} />

      <Card>
        <CardHeader title="App" description="How the SDK, scripts and URLs refer to this app. These never change." />
        <CardBody>
          <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-8 gap-y-2.5 text-[0.8125rem]">
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="font-mono text-xs font-medium">{app.slug}</dd>
            <dt className="text-muted-foreground">App ID</dt>
            <dd>
              <IdCopy value={app.id} />
            </dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <StatusBadge status={app.status} />
            </dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="tabular-nums">
              <Time value={app.createdAt} />
            </dd>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Name" description="Shown in the admin panel only." />
        <CardBody>
          <ActionForm action={renameApp.bind(null, app.slug)} submitLabel="Rename" successMessage="App renamed" inline>
            <Input name="name" aria-label="Name" defaultValue={app.name} required maxLength={80} />
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Status"
          description={
            active
              ? 'Disabling stops the app for everyone: sign-in, events, config and purchases are refused. Nothing is deleted, and it can be enabled again.'
              : 'The app is disabled and does not work for anyone. Enabling it brings everything back, with the same sessions and data.'
          }
        />
        <CardBody>
          {active ? (
            <ConfirmActionButton
              action={disableApp.bind(null, app.slug)}
              label="Disable app"
              title={`Disable ${app.name}?`}
              description="The app stops working for everyone at once. Data and sessions stay, and the app can be enabled again."
              confirmLabel="Disable app"
              pendingLabel="Disabling…"
              requireReason
              reasonPlaceholder="e.g. replaced by version 2"
              successMessage="App disabled"
            />
          ) : (
            <ActionForm
              action={enableApp.bind(null, app.slug)}
              submitLabel="Enable app"
              pendingLabel="Enabling…"
              successMessage="App enabled"
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}