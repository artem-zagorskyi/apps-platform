'use client';

import { useState } from 'react';
import { ChevronRight, Lock } from 'lucide-react';
import { DataTable } from '@/components/data/data-table';
import { EmptyRow } from '@/components/data/states';
import { FileCheckUpload } from '@/components/settings/shared/file-check-upload';
import { CardSection, SettingsCard, SettingsColumn } from '@/components/settings/shared/settings-card';
import { Time } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';

const SCRIPT = 'plan:upload script';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Plan JSON → sorted rows. jsonb does not keep the order of the file anyway.
function toEvents(plan) {
  return Object.entries(plan.events)
    .map(([name, event]) => ({
      name,
      ...event,
      properties: Object.entries(event.properties)
        .map(([propertyName, property]) => ({ name: propertyName, ...property }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function range({ min, max }) {
  if (min !== undefined && max !== undefined) return `${min} to ${max}`;
  if (min !== undefined) return `${min} or more`;
  if (max !== undefined) return `up to ${max}`;
  return 'any';
}

function AllowedValues({ property }) {
  if (property.type === 'enum') {
    return (
      <span className="flex flex-wrap gap-1">
        {property.values.map((value) => (
          <code key={value} className="rounded border border-border bg-card px-1 font-mono text-[11px]">
            {value}
          </code>
        ))}
      </span>
    );
  }
  const text =
    property.type === 'boolean'
      ? 'true or false'
      : property.type === 'string'
        ? `up to ${property.max_length} characters`
        : range(property);
  return <span className="text-muted-foreground">{text}</span>;
}

function PropertyTable({ properties }) {
  if (properties.length === 0) {
    return (
      <div className="border-t border-border bg-muted px-4 py-2.5 pl-12 text-xs text-muted-foreground">
        No properties besides the standard ones (app version, platform).
      </div>
    );
  }
  const grid = 'grid grid-cols-[minmax(150px,1fr)_70px_70px_minmax(0,1.3fr)] gap-3';
  return (
    <div className="border-t border-border bg-muted py-1.5 pl-12 pr-4">
      <div className={cn(grid, 'py-1 text-[11px] font-medium text-muted-foreground')}>
        <span>Property</span>
        <span>Type</span>
        <span>Required</span>
        <span>Allowed values</span>
      </div>
      {properties.map((property) => (
        <div key={property.name} className={cn(grid, 'items-baseline py-1 text-xs', property.deprecated && 'opacity-60')}>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-mono font-medium">{property.name}</span>
              {property.deprecated && (
                <Badge tone="outline" size="sm">
                  deprecated
                </Badge>
              )}
            </span>
            {property.description && <span className="text-[11px] text-muted-foreground">{property.description}</span>}
          </span>
          <span className="font-mono text-muted-foreground">{property.type}</span>
          <span>{property.required ? 'yes' : <span className="text-muted-foreground">no</span>}</span>
          <AllowedValues property={property} />
        </div>
      ))}
    </div>
  );
}

// Events with click-to-expand properties; a filter once the list gets long
function EventList({ events }) {
  const [open, setOpen] = useState(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const search = query.trim().toLowerCase();
  const shown = events.filter(
    (event) => (category === 'all' || event.category === category) && (!search || event.name.includes(search)),
  );
  const grid = { gridTemplateColumns: '28px minmax(180px,1.3fr) 96px 80px minmax(0,1fr)' };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {events.length > 6 && (
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter events"
              aria-label="Filter events"
              className="min-w-[180px] flex-1"
            />
            <Segmented
              value={category}
              onValueChange={setCategory}
              options={[
                { value: 'all', label: 'All' },
                { value: 'essential', label: 'essential' },
                { value: 'analytics', label: 'analytics' },
              ]}
            />
          </div>
        )}
        <div
          className="grid h-8 items-center gap-3 border-t border-border bg-muted px-4 text-xs font-medium text-muted-foreground"
          style={grid}
        >
          <span />
          <span>Event</span>
          <span>Category</span>
          <span className="text-right">Properties</span>
          <span>Description</span>
        </div>
        {shown.map((event) => {
          const isOpen = open === event.name;
          return (
            <div key={event.name}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : event.name)}
                aria-expanded={isOpen}
                className={cn(
                  'grid min-h-10 w-full items-center gap-3 border-t border-border px-4 text-left text-[13px] hover:bg-accent',
                  isOpen && 'bg-muted',
                  event.deprecated && 'opacity-60',
                )}
                style={grid}
              >
                <ChevronRight
                  className={cn('size-3.5 text-muted-foreground transition-transform', isOpen && 'rotate-90')}
                />
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-xs font-medium">{event.name}</span>
                  {event.deprecated && (
                    <Badge tone="outline" size="sm">
                      deprecated
                    </Badge>
                  )}
                </span>
                <span>
                  <Badge tone={event.category === 'essential' ? 'neutral' : 'primary'} size="sm" className="font-mono">
                    {event.category}
                  </Badge>
                </span>
                <span className="text-right tabular-nums">{event.properties.length}</span>
                <span className="truncate text-xs text-muted-foreground">{event.description}</span>
              </button>
              {isOpen && <PropertyTable properties={event.properties} />}
            </div>
          );
        })}
        {shown.length === 0 && <EmptyRow>No events match.</EmptyRow>}
      </div>
    </div>
  );
}

const HISTORY_COLUMNS = [
  { key: 'version', header: 'Version', width: '64px', mono: true },
  { key: 'uploadedAt', header: 'Uploaded', width: '150px' },
  { key: 'uploadedBy', header: 'By', width: 'minmax(120px,0.8fr)' },
  { key: 'summary', header: 'Changes', width: 'minmax(180px,1.4fr)' },
  { key: 'current', header: '', width: '64px', align: 'right' },
];

/**
 * overview: { current: { version, uploadedAt, uploadedBy, plan } | null,
 *             history: [{ version, uploadedAt, uploadedBy, events, summary }],
 *             platform: plan JSON of the standard events }
 * actions: bound server actions { check(text), upload(text) }
 */
export function EventsPanel({ overview, actions }) {
  const { current, history, platform } = overview;
  const platformEvents = toEvents(platform);

  const rows = history.map((version) => ({
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
      <SettingsCard
        title={current ? `Tracking plan v${current.version}` : 'Tracking plan'}
        description={
          current ? (
            <>
              Uploaded <Time value={current.uploadedAt} /> by {current.uploadedBy ?? `the ${SCRIPT}`} ·{' '}
              {plural(Object.keys(current.plan.events).length, 'event', 'events')}. Events outside the plan and the
              platform events are rejected.
            </>
          ) : (
            'No plan yet: the platform accepts only its standard events. Upload the tracking_plan.json written by the SDK generator.'
          )
        }
      >
        {current && <EventList events={toEvents(current.plan)} />}
      </SettingsCard>

      <SettingsCard
        title="Upload a new version"
        description="Checked against the current version first. Removing an event or property breaks installed app versions: mark it deprecated instead."
      >
        <CardSection border={false} className="pt-0">
          <FileCheckUpload
            fileName="tracking_plan.json"
            checkAction={actions.check}
            uploadAction={actions.upload}
            successMessage={(data) =>
              data.status === 'created'
                ? `Tracking plan v${data.version} uploaded. Events are checked against it within a minute.`
                : `Nothing uploaded: the plan is the same as v${data.version}`
            }
          />
        </CardSection>
      </SettingsCard>

      <SettingsCard title="Version history" description="The last 20 versions and what each one changed.">
        <DataTable
          columns={HISTORY_COLUMNS}
          rows={rows}
          minWidth={560}
          empty={<EmptyRow>No versions yet.</EmptyRow>}
        />
      </SettingsCard>

      <SettingsCard
        title={
          <span className="inline-flex items-center gap-2">
            Platform events
            <Badge tone="outline" size="sm">
              <Lock className="size-3" />
              read-only
            </Badge>
          </span>
        }
        description={`${plural(platformEvents.length, 'standard event', 'standard events')} every app sends. Maintained with the platform, the same for every app.`}
      >
        <EventList events={platformEvents} />
      </SettingsCard>
    </SettingsColumn>
  );
}