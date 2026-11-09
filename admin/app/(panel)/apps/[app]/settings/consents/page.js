import { ActionForm } from '@/components/action-form';
import { ConfirmActionButton } from '@/components/confirm-action-button';
import { EmptyState } from '@/components/data/states';
import { Callout } from '@/components/settings/shared/callout';
import { CardSection, KeyValueList, SettingsCard, SettingsColumn } from '@/components/settings/shared/settings-card';
import { Input } from '@/components/ui/input';
import { getApp, getConsentSettings } from '@/lib/apps';
import { cn } from '@/lib/utils';
import { newConsentVersion, saveConsentPolicy } from '../actions';

const MODES = [
  {
    value: 'optional',
    help: 'The consent screen shows on first launch. If the person refuses, the app works normally without analytics and personalization.',
  },
  {
    value: 'consent_or_pay',
    help: 'The person either agrees or buys an ad-free subscription. Needs a product in Subscriptions.',
  },
];

export default async function ConsentsSettingsPage({ params }) {
  const { app: slug } = await params;
  const [{ app }, { policy, activeInstallations }] = await Promise.all([getApp(slug), getConsentSettings(slug)]);
  const people = `${activeInstallations.toLocaleString('en-US')} installation${activeInstallations === 1 ? '' : 's'} active in the last 30 days`;

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

  return (
    <SettingsColumn>
      <Callout tone="info" title="One policy for everyone">
        Renvix is a business in the EU, so the GDPR covers every user of the app wherever they live. Everyone gets the
        same consent screen; nobody&apos;s country is guessed.
      </Callout>

      <SettingsCard
        title="Consent screen"
        description="What happens on first launch. Changing it does not ask anyone again: use a new policy version for that."
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
                // No ad-free product can be sold yet: offered once Subscriptions is set up
                const blocked = mode.value === 'consent_or_pay' && policy.mode !== 'consent_or_pay';
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
                        <span className="text-xs text-muted-foreground">Available once the app sells an ad-free product.</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </fieldset>
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
            { label: 'Applies to', value: people },
          ]}
        />
        <CardSection className="flex-row items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Use it when the consent text or the purposes change.
          </span>
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