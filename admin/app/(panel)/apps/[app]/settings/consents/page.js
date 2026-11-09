import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { ConfirmActionButton } from '@/components/confirm-action-button';
import { EmptyState } from '@/components/data/states';
import { Callout } from '@/components/settings/shared/callout';
import { CardSection, KeyValueList, SettingsCard, SettingsColumn } from '@/components/settings/shared/settings-card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { getApp, getConsentSettings } from '@/lib/apps';
import { cn } from '@/lib/utils';
import { newConsentVersion, saveConsentPolicy } from '../actions';

const STORE = { google_play: 'Google Play', app_store: 'App Store' };
const storeNames = (stores) => stores.map((store) => STORE[store] ?? store).join(', ');

const MODES = [
  {
    value: 'optional',
    help: 'The consent screen shows on first launch. If the person refuses, the app works normally without analytics and personalization.',
  },
  {
    value: 'consent_or_pay',
    help: 'The person either agrees or buys the paid alternative below; there is no free use after a refusal. Meant for apps with ads: the paid version must have every feature.',
  },
];

export default async function ConsentsSettingsPage({ params }) {
  const { app: slug } = await params;
  const [{ app }, { policy, activeInstallations, entitlements }] = await Promise.all([
    getApp(slug),
    getConsentSettings(slug),
  ]);
  const people = `${activeInstallations.toLocaleString('en-US')} installation${activeInstallations === 1 ? '' : 's'} active in the last 30 days`;
  const subscriptionsHref = `/apps/${encodeURIComponent(app.slug)}/settings/subscriptions`;

  if (!policy) {
    return (
      <SettingsColumn>
        <EmptyState
          title="No consent policy yet"
          action={
            <ActionForm
              action={saveConsentPolicy.bind(null, app.slug)}
              submitLabel="Add the default policy"
              pendingLabel="Adding…"
              successMessage="Consent policy added"
            >
              <input type="hidden" name="mode" value="optional" />
              <input type="hidden" name="repromptAfterDays" value="180" />
            </ActionForm>
          }
        >
          Until a policy exists, the app asks everyone with the optional consent screen under version 0. The default
          policy is the same: optional, ask again 180 days after a refusal, versioned from today.
        </EmptyState>
      </SettingsColumn>
    );
  }

  const onSale = new Map(entitlements.map((entitlement) => [entitlement.key, entitlement.stores]));
  const payStores = policy.payEntitlement ? onSale.get(policy.payEntitlement) : undefined;
  const defaultEntitlement =
    (payStores && policy.payEntitlement) ?? (onSale.has('ad_free') ? 'ad_free' : entitlements[0]?.key);

  return (
    <SettingsColumn>
      <Callout tone="info" title="One policy for everyone">
        Renvix is a business in the EU, so the GDPR covers every user of the app wherever they live. Everyone gets the
        same consent screen; nobody&apos;s country is guessed.
      </Callout>

      {policy.mode === 'consent_or_pay' && !payStores && (
        <Callout tone="warning" title={`${policy.payEntitlement} is not on sale`}>
          No product on sale grants it, so the app works as optional until one does. Upload a catalog in{' '}
          <Link href={subscriptionsHref} className="underline">
            Subscriptions
          </Link>{' '}
          or choose another entitlement.
        </Callout>
      )}

      <SettingsCard
        title="Consent screen"
        description="What happens on first launch. A new mode publishes a new policy version and asks everyone again; the interval and the paid alternative do not."
      >
        <CardSection>
          <ActionForm
            action={saveConsentPolicy.bind(null, app.slug)}
            submitLabel="Save"
            successMessage="Consent policy saved"
            variant="outline"
          >
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-xs font-medium">Mode</legend>
              {MODES.map((mode) => {
                // Nothing to buy instead of consent until the catalog grants an entitlement
                const blocked =
                  mode.value === 'consent_or_pay' && entitlements.length === 0 && policy.mode !== 'consent_or_pay';
                return (
                  <label
                    key={mode.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft',
                      blocked && 'cursor-not-allowed opacity-55',
                    )}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value={mode.value}
                      defaultChecked={policy.mode === mode.value}
                      disabled={blocked}
                      className="mt-0.5 accent-[var(--primary)]"
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-mono text-xs font-semibold">{mode.value}</span>
                      <span className="text-xs text-muted-foreground text-pretty">{mode.help}</span>
                      {blocked && (
                        <span className="text-xs text-muted-foreground">
                          Available once a product on sale grants an entitlement.
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {entitlements.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium">Paid alternative</span>
                <Select
                  name="payEntitlement"
                  aria-label="Paid alternative"
                  defaultValue={defaultEntitlement}
                  items={entitlements.map((entitlement) => ({
                    value: entitlement.key,
                    label: `${entitlement.key} · ${storeNames(entitlement.stores)}`,
                  }))}
                />
                <span className="text-xs text-muted-foreground text-pretty">
                  Used in consent_or_pay: an active purchase granting it replaces consent. On a platform whose store
                  does not sell it, the app works as optional.
                </span>
              </div>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Ask again after a refusal</span>
              <span className="flex items-center gap-2">
                <Input
                  type="number"
                  name="repromptAfterDays"
                  min={30}
                  max={730}
                  required
                  defaultValue={policy.repromptAfterDays}
                  className="w-24 tabular-nums"
                />
                <span className="text-[0.8125rem] text-muted-foreground">days, 30 to 730</span>
              </span>
            </label>
          </ActionForm>
        </CardSection>
      </SettingsCard>

      <SettingsCard
        title="Policy version"
        description="Every decision is recorded under a policy version. A new version asks everyone again on next launch; earlier decisions stay in the log."
      >
        <KeyValueList
          items={[
            { label: 'Current version', value: policy.policyVersion, mono: true },
            { label: 'Mode', value: policy.mode, mono: true },
            ...(policy.mode === 'consent_or_pay'
              ? [{ label: 'Paid alternative', value: policy.payEntitlement, mono: true }]
              : []),
            { label: 'Applies to', value: people },
          ]}
        />
        <CardSection className="flex-row items-center justify-between">
          <span className="text-xs text-muted-foreground">Use it when the consent text or the purposes change.</span>
          <ConfirmActionButton
            action={newConsentVersion.bind(null, app.slug)}
            label="Ask everyone again"
            variant="outline"
            title="Publish a new policy version?"
            description={`Everyone sees the consent screen again on next launch: about ${people}. Earlier decisions stay in the log.`}
            confirmLabel="Ask everyone again"
            pendingLabel="Publishing…"
            requireReason
            reasonPlaceholder="e.g. new analytics purpose added to the consent text"
            successMessage="New policy version published"
          />
        </CardSection>
      </SettingsCard>
    </SettingsColumn>
  );
}