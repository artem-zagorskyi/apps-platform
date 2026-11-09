import Link from 'next/link';
import { ConfirmActionButton } from '@/components/confirm-action-button';
import { DataTable } from '@/components/data/data-table';
import { EmptyRow } from '@/components/data/states';
import { StatusBadge } from '@/components/data/status-badge';
import { Time } from '@/components/time';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { getApp, getSignInSettings } from '@/lib/apps';
import { addOAuthClient, createBackendKey, removeOAuthClient, revokeBackendKey } from '../actions';
import { AddClientForm } from './add-client-form';
import { CreateKeyForm } from './create-key-form';

const PROVIDER_LABELS = { google: 'Google', apple: 'Apple' };
const PLATFORM_LABELS = { android: 'Android', ios: 'iOS' };

// Cells are built here, on the server, so the client table receives no functions
const CLIENT_COLUMNS = [
  { key: 'provider', header: 'Provider', width: '5.625rem' },
  { key: 'platform', header: 'Platform', width: '5.625rem' },
  { key: 'clientId', header: 'Client ID', width: 'minmax(13.75rem,1fr)' },
  { key: 'createdAt', header: 'Added', width: '9.375rem' },
  { key: 'actions', header: '', width: '5.625rem', align: 'right' },
];

const KEY_COLUMNS = [
  { key: 'kid', header: 'Key ID', width: 'minmax(12.5rem,1fr)', mono: true },
  { key: 'createdAt', header: 'Created', width: '9.375rem' },
  { key: 'state', header: 'State', width: 'minmax(12.5rem,1fr)' },
  { key: 'actions', header: '', width: '5.625rem', align: 'right' },
];

export default async function SignInSettingsPage({ params }) {
  const { app: slug } = await params;
  const [{ app, platforms }, settings] = await Promise.all([getApp(slug), getSignInSettings(slug)]);

  const clientRows = settings.oauthClients.map((client) => ({
    id: client.id,
    provider: PROVIDER_LABELS[client.provider],
    platform: PLATFORM_LABELS[client.platform],
    clientId: (
      <span className="font-mono text-xs" title={client.clientId}>
        {client.clientId}
      </span>
    ),
    createdAt: <Time value={client.createdAt} />,
    actions: (
      <ConfirmActionButton
        action={removeOAuthClient.bind(null, app.slug, client.id)}
        label="Remove"
        size="sm"
        title={`Remove this ${PROVIDER_LABELS[client.provider]} client?`}
        description={`New sign-ins with tokens issued for ${client.clientId} will be refused. People already signed in stay signed in.`}
        confirmLabel="Remove client"
        pendingLabel="Removing…"
        successMessage="Client removed"
      />
    ),
  }));

  const keyRows = settings.identityKeys.map((key) => ({
    id: key.kid,
    kid: key.kid,
    createdAt: <Time value={key.createdAt} />,
    state: key.revokedAt ? (
      <span className="flex items-center gap-2">
        <StatusBadge status="disabled" label="revoked" />
        <span className="text-xs text-muted-foreground">
          <Time value={key.revokedAt} />
        </span>
      </span>
    ) : (
      <StatusBadge status="active" />
    ),
    actions: key.revokedAt ? null : (
      <ConfirmActionButton
        action={revokeBackendKey.bind(null, app.slug, key.kid)}
        label="Revoke"
        size="sm"
        title={`Revoke ${key.kid}?`}
        description="Sign-in assertions signed with this key are refused from now on. If the app backend still uses it, its sign-in stops working. This cannot be undone."
        confirmLabel="Revoke key"
        pendingLabel="Revoking…"
        confirmText={key.kid}
        requireReason
        reasonPlaceholder="e.g. rotated, or leaked in a log"
        successMessage="Key revoked"
      />
    ),
  }));

  const platformNames = platforms.map((entry) => entry.platform);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Google and Apple"
          description="Client IDs that sign-in tokens may be issued for. For Google it is the web (server) client ID the app passes as serverClientId; one usually serves both platforms."
        />
        {clientRows.length > 0 ? (
          <DataTable columns={CLIENT_COLUMNS} rows={clientRows} minWidth={680} />
        ) : (
          <EmptyRow>No clients yet: Google and Apple sign-in are refused.</EmptyRow>
        )}
        <CardBody className="border-t border-border pt-4">
          {platformNames.length > 0 ? (
            <AddClientForm action={addOAuthClient.bind(null, app.slug)} platforms={platformNames} />
          ) : (
            <p className="text-[0.8125rem] text-muted-foreground">
              Add a platform first, on the{' '}
              <Link
                href={`/apps/${app.slug}/settings/platforms`}
                className="text-primary-soft-foreground hover:underline"
              >
                Platforms
              </Link>{' '}
              tab.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Backend keys"
          description="For apps with accounts of their own: the app backend signs sign-in assertions with the private key. To rotate, create a new key, deploy it to the backend, then revoke the old one."
        />
        {keyRows.length > 0 ? (
          <DataTable columns={KEY_COLUMNS} rows={keyRows} minWidth={600} />
        ) : (
          <EmptyRow>No keys yet: sign-in with the app's own accounts is refused.</EmptyRow>
        )}
        <CardBody className="border-t border-border pt-4">
          <CreateKeyForm action={createBackendKey.bind(null, app.slug)} />
        </CardBody>
      </Card>
    </div>
  );
}