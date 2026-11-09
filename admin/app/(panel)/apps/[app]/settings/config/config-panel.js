'use client';

import Link from 'next/link';
import { ArrowUpRight, Lock } from 'lucide-react';
import { ActionForm } from '@/components/action-form';
import { DataTable } from '@/components/data/data-table';
import { EmptyRow } from '@/components/data/states';
import { Callout } from '@/components/settings/shared/callout';
import { FileCheckUpload } from '@/components/settings/shared/file-check-upload';
import { CardSection, SettingsCard, SettingsColumn } from '@/components/settings/shared/settings-card';
import { Time } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

const SCRIPT = 'a script';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function limits(parameter) {
  switch (parameter.type) {
    case 'boolean':
      return 'true or false';
    case 'string':
      return `up to ${parameter.max_length} characters`;
    case 'enum':
      return parameter.values.join(' · ');
    default: {
      const { min, max } = parameter;
      if (min !== undefined && max !== undefined) return `${min} to ${max}`;
      if (min !== undefined) return `${min} or more`;
      if (max !== undefined) return `up to ${max}`;
      return 'any';
    }
  }
}

const PARAMETER_COLUMNS = [
  { key: 'name', header: 'Name', width: 'minmax(11.25rem,1.3fr)' },
  { key: 'type', header: 'Type', width: '4.375rem', mono: true },
  { key: 'builtIn', header: 'Built-in', width: 'minmax(5.625rem,0.8fr)', mono: true },
  { key: 'limits', header: 'Allowed values', width: 'minmax(8.75rem,1fr)' },
];

const HISTORY_COLUMNS = [
  { key: 'version', header: 'Version', width: '4rem', mono: true },
  { key: 'uploadedAt', header: 'Uploaded', width: '9.375rem' },
  { key: 'uploadedBy', header: 'By', width: 'minmax(7.5rem,0.8fr)' },
  { key: 'summary', header: 'Changes', width: 'minmax(11.25rem,1.4fr)' },
  { key: 'current', header: '', width: '4rem', align: 'right' },
];

/**
 * overview: { current: { version, uploadedAt, uploadedBy, schema } | null,
 *             history: [{ version, uploadedAt, uploadedBy, parameters, summary }],
 *             holdout: { percent, configVersion, runningExperiments: [key] } }
 * configHref: the Config & experiments section of this app
 * actions: bound server actions { check(text), upload(text), setHoldout(prev, formData) }
 */
export function ConfigPanel({ overview, configHref, actions }) {
  const { current, history, holdout } = overview;
  const locked = holdout.runningExperiments.length > 0;

  const parameters = Object.entries(current?.schema.parameters ?? {})
    .map(([name, parameter]) => ({ name, ...parameter }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parameterRows = parameters.map((parameter) => ({
    id: parameter.name,
    name: (
      <span className="flex min-w-0 flex-col py-1" title={parameter.description}>
        <span className="flex items-center gap-2">
          <span className="truncate font-mono text-xs font-medium">{parameter.name}</span>
          {parameter.deprecated && (
            <Badge tone="outline" size="sm">
              deprecated
            </Badge>
          )}
        </span>
        {parameter.description && (
          <span className="truncate text-[0.6875rem] text-muted-foreground">{parameter.description}</span>
        )}
      </span>
    ),
    type: <span className="text-muted-foreground">{parameter.type}</span>,
    builtIn: <span title={JSON.stringify(parameter.default)}>{JSON.stringify(parameter.default)}</span>,
    limits: <span className="text-xs text-muted-foreground">{limits(parameter)}</span>,
  }));

  const historyRows = history.map((version) => ({
    id: version.version,
    version: <span className="font-semibold">v{version.version}</span>,
    uploadedAt: (
      <span className="text-xs">
        <Time value={version.uploadedAt} />
      </span>
    ),
    uploadedBy: <span className="text-xs">{version.uploadedBy ?? SCRIPT}</span>,
    summary: (
      <span className="text-xs text-muted-foreground" title={version.summary}>
        {version.summary}
      </span>
    ),
    current:
      current?.version === version.version ? (
        <Badge tone="success" size="sm">
          current
        </Badge>
      ) : null,
  }));

  return (
    <SettingsColumn>
      <Callout
        action={
          <Link
            href={configHref}
            className="inline-flex shrink-0 items-center gap-1 text-[0.8125rem] font-medium text-primary-soft-foreground hover:underline"
          >
            Config &amp; experiments
            <ArrowUpRight className="size-3.5" />
          </Link>
        }
      >
        This tab declares which parameters exist and what values they accept. Server values, rules and experiments
        live in Config &amp; experiments.
      </Callout>

      <SettingsCard
        title={current ? `Parameters · schema v${current.version}` : 'Parameters'}
        description={
          current ? (
            <>
              Uploaded <Time value={current.uploadedAt} /> by {current.uploadedBy ?? SCRIPT} ·{' '}
              {plural(parameters.length, 'parameter', 'parameters')}. The built-in value ships inside the app and is
              used when nothing else applies.
            </>
          ) : (
            'No schema yet. Upload the remote_config.json written by the SDK generator to declare parameters.'
          )
        }
      >
        {current && (
          <DataTable
            columns={PARAMETER_COLUMNS}
            rows={parameterRows}
            minWidth={560}
            empty={<EmptyRow>The schema declares no parameters.</EmptyRow>}
          />
        )}
      </SettingsCard>

      <SettingsCard
        title="Upload a new schema"
        description="Checked first. Removing a parameter or changing its type breaks installed app versions, and the published config must still fit the new limits."
      >
        <CardSection border={false} className="pt-0">
          <FileCheckUpload
            fileName="remote_config.json"
            checkAction={actions.check}
            uploadAction={actions.upload}
            successMessage={(data) =>
              data.status === 'created'
                ? `Parameter schema v${data.version} uploaded`
                : `Nothing uploaded: the schema is the same as v${data.version}`
            }
          />
        </CardSection>
      </SettingsCard>

      <SettingsCard title="Version history" description="The last 20 versions and what each one changed.">
        <DataTable
          columns={HISTORY_COLUMNS}
          rows={historyRows}
          minWidth={560}
          empty={<EmptyRow>No versions yet.</EmptyRow>}
        />
      </SettingsCard>

      <SettingsCard
        title="Holdout"
        description="Users who never enter any experiment. They show what happens without experiments."
        actions={
          locked ? (
            <Badge tone="outline">
              <Lock className="size-3" />
              Locked
            </Badge>
          ) : null
        }
      >
        <CardSection>
          {locked ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums">{holdout.percent}%</span>
                <span className="text-[0.8125rem] text-muted-foreground">of users</span>
              </div>
              <Callout tone="warning" title="Can't change while experiments run">
                A new holdout would move people in or out of running experiments and spoil their results. Stop these
                first:
              </Callout>
              <ul className="flex flex-col">
                {holdout.runningExperiments.map((key) => (
                  <li
                    key={key}
                    className="flex items-center gap-2 border-t border-border py-2 text-[0.8125rem] first:border-t-0"
                  >
                    <Badge tone="primary" dot size="sm">
                      running
                    </Badge>
                    <span className="font-mono text-xs font-medium">{key}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <ActionForm
              action={actions.setHoldout}
              submitLabel="Save"
              successMessage="Holdout saved as a new config version"
              variant="outline"
              inline
            >
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  name="percent"
                  required
                  min={0}
                  max={50}
                  step={0.01}
                  defaultValue={holdout.percent}
                  className="w-24 tabular-nums"
                  aria-label="Holdout percent"
                />
                <span className="text-[0.8125rem] text-muted-foreground">% of users, 0 to 50</span>
              </div>
            </ActionForm>
          )}
          <span className="text-xs text-muted-foreground">
            {holdout.configVersion
              ? `From config v${holdout.configVersion}. Saving publishes a new config version with only the holdout changed.`
              : 'No config published yet. Saving publishes the first version with only the holdout set.'}
          </span>
        </CardSection>
      </SettingsCard>
    </SettingsColumn>
  );
}