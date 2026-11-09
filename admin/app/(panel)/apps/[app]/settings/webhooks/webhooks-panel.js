'use client';

import { useState, useTransition } from 'react';
import { Send } from 'lucide-react';
import { ActionForm } from '@/components/action-form';
import { ConfirmActionButton } from '@/components/confirm-action-button';
import { DataTable } from '@/components/data/data-table';
import { SecretOnce } from '@/components/data/secret-once';
import { EmptyRow } from '@/components/data/states';
import { StatusBadge } from '@/components/data/status-badge';
import { Callout } from '@/components/settings/shared/callout';
import { CardSection, KeyValueList, SettingsCard, SettingsColumn } from '@/components/settings/shared/settings-card';
import { Time } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const TYPES = 'user.merged, user.deleted and entitlements.changed';

// Delivery state from the API → status badge and its label
const DELIVERY_STATUS = {
  delivered: ['delivered', 'delivered'],
  failed: ['failed', 'failed'],
  pending: ['waiting', 'pending'],
  no_endpoint: ['waiting', 'no URL'],
};

const COLUMNS = [
  { key: 'type', header: 'Type', width: 'minmax(10.625rem,1fr)', mono: true },
  { key: 'status', header: 'Status', width: '6.875rem' },
  { key: 'http', header: 'HTTP', width: '4rem', mono: true },
  { key: 'attempts', header: 'Attempts', width: '4.5rem', align: 'right' },
  { key: 'createdAt', header: 'Created', width: '9.375rem' },
];

const count = (n) => n.toLocaleString('en-US');

/**
 * overview: { endpoint: { url, createdAt, secretRotatedAt } | null,
 *             stats: { delivered7d, notDelivered7d, successRate7d (0–1 | null), waitingForUrl },
 *             recent: [{ id, type, status, lastStatus, lastError, attempts, createdAt }] }
 * actions: bound server actions { setUrl(prev, formData), rotateSecret(), sendTest(), removeUrl(reason) }
 *
 * One tree for both states (with and without a URL), so the URL form keeps its
 * place and the secret returned by the first save survives the page refresh.
 */
export function WebhooksPanel({ overview, actions }) {
  const { endpoint, stats, recent } = overview;
  const [secret, setSecret] = useState(null);
  const [test, setTest] = useState(null);
  const [testing, startTest] = useTransition();
  const low = stats.successRate7d !== null && stats.successRate7d < 0.9;

  function runTest() {
    startTest(async () => {
      const result = await actions.sendTest();
      setTest(result.error ? { ok: false, httpStatus: null, ms: null, error: result.error } : result.data);
    });
  }

  async function rotate() {
    const result = await actions.rotateSecret();
    if (result?.ok) setSecret({ value: result.data.secret, first: false });
    return result;
  }

  async function remove(reason) {
    const result = await actions.removeUrl(reason);
    if (result?.ok) {
      setSecret(null);
      setTest(null);
    }
    return result;
  }

  const rows = recent.map((delivery) => {
    const [status, label] = DELIVERY_STATUS[delivery.status] ?? ['waiting', delivery.status];
    return {
      id: delivery.id,
      type: delivery.type,
      status: <StatusBadge status={status} label={label} />,
      http: (
        <span
          title={delivery.lastError ?? undefined}
          className={cn(delivery.status === 'delivered' ? 'text-success' : delivery.lastStatus && 'text-destructive')}
        >
          {delivery.lastStatus ?? '—'}
        </span>
      ),
      attempts: delivery.attempts,
      createdAt: <Time value={delivery.createdAt} />,
    };
  });

  return (
    <SettingsColumn>
      <SettingsCard
        title="Webhook URL"
        description={`The app backend receives ${TYPES}.`}
        actions={
          endpoint ? (
            low ? (
              <Badge tone="destructive" dot>
                Needs attention
              </Badge>
            ) : (
              <Badge tone="success" dot>
                Configured
              </Badge>
            )
          ) : (
            <Badge tone="outline">Optional</Badge>
          )
        }
      >
        {!endpoint && stats.waitingForUrl > 0 && (
          <CardSection border={false} className="pt-0">
            <Callout
              tone="warning"
              title={`${count(stats.waitingForUrl)} notification${stats.waitingForUrl === 1 ? '' : 's'} waiting`}
            >
              No URL is set, so they wait undelivered. Once a URL is set, those from the last 7 days are sent.
            </Callout>
          </CardSection>
        )}
        <CardSection border={false} className="pt-0">
          <ActionForm
            action={actions.setUrl}
            submitLabel={endpoint ? 'Save' : 'Set URL'}
            successMessage={endpoint ? 'URL saved. The secret stays the same.' : 'Webhook URL set'}
            variant={endpoint ? 'outline' : 'default'}
            inline
            onSuccess={(state) => state.data?.secret && setSecret({ value: state.data.secret, first: true })}
          >
            <Input
              type="url"
              name="url"
              required
              mono
              defaultValue={endpoint?.url ?? ''}
              placeholder="https://api.example.com/platform-webhooks"
              aria-label="Webhook URL"
            />
          </ActionForm>
          <span className="text-xs text-muted-foreground">
            {endpoint
              ? 'Changing the URL keeps the signing secret.'
              : 'Optional: only for apps with a backend. A signing secret is created with the URL and shown once.'}
          </span>
        </CardSection>

        {secret && (
          <CardSection>
            <SecretOnce
              title={secret.first ? 'Signing secret' : 'New signing secret'}
              description={
                secret.first
                  ? 'Put it on the app backend to verify signatures.'
                  : 'Put it on the app backend now: the old secret no longer works.'
              }
              value={secret.value}
            />
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setSecret(null)}>
                I&apos;ve saved it
              </Button>
            </div>
          </CardSection>
        )}

        {endpoint && (
          <KeyValueList
            items={[
              {
                label: 'Signing secret',
                value: (
                  <span className="tabular-nums">
                    Last changed <Time value={endpoint.secretRotatedAt} />
                  </span>
                ),
              },
              {
                label: 'Delivered · 7 d',
                value:
                  stats.successRate7d === null ? (
                    <span className="text-muted-foreground">No delivery attempts in the last 7 days</span>
                  ) : (
                    <span className="flex items-center gap-2 tabular-nums">
                      <b className={cn('font-semibold', low && 'text-destructive')}>
                        {Math.round(stats.successRate7d * 100)}%
                      </b>
                      <span className="text-xs text-muted-foreground">
                        {count(stats.delivered7d)} delivered · {count(stats.notDelivered7d)} not delivered
                      </span>
                    </span>
                  ),
              },
            ]}
          />
        )}

        {endpoint && (
          <CardSection className="flex-row flex-wrap items-center gap-2">
            <Button variant="outline" disabled={testing} onClick={runTest}>
              <Send />
              {testing ? 'Sending…' : 'Send test notification'}
            </Button>
            {test && (
              <span role="status" className="inline-flex items-center gap-2 text-[0.8125rem]">
                <Badge tone={test.ok ? 'success' : 'destructive'} className="font-mono">
                  {test.httpStatus ? `HTTP ${test.httpStatus}` : 'No response'}
                </Badge>
                <span className="text-muted-foreground tabular-nums">
                  {test.ms != null ? `${test.ms} ms` : ''}
                  {test.error && !test.httpStatus ? `${test.ms != null ? ' · ' : ''}${test.error}` : ''}
                </span>
              </span>
            )}
            <span className="ml-auto flex gap-2">
              <ConfirmActionButton
                action={rotate}
                label="New secret"
                variant="outline"
                title="Issue a new signing secret?"
                description="The old secret stops working at once. Until the app backend has the new one, it rejects every notification as wrongly signed."
                confirmLabel="Issue new secret"
                pendingLabel="Issuing…"
                confirmText="new secret"
                successMessage="New signing secret issued"
              />
              <ConfirmActionButton
                action={remove}
                label="Remove URL"
                title="Remove the webhook URL?"
                description="Notifications stop being delivered and wait undelivered. The signing secret is deleted."
                confirmLabel="Remove URL"
                pendingLabel="Removing…"
                requireReason
                reasonPlaceholder="e.g. the app backend was shut down"
                successMessage="Webhook URL removed"
              />
            </span>
          </CardSection>
        )}
      </SettingsCard>

      <SettingsCard title="Recent deliveries" description="The last five notifications for this app.">
        <DataTable columns={COLUMNS} rows={rows} minWidth={560} empty={<EmptyRow>No notifications yet.</EmptyRow>} />
      </SettingsCard>
    </SettingsColumn>
  );
}