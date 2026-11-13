'use client';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// The built-in traits as the admin API names them, in display order
const TRAITS = [
  { key: 'engagement', label: 'Engagement', type: 'choice', options: ['new', 'returning', 'core', 'casual'] },
  { key: 'daysSinceInstall', label: 'Days since install', type: 'number', max: 3650 },
  { key: 'daysSinceLastVisit', label: 'Days away before this visit', type: 'number', max: 3650, nullable: 'first visit' },
  { key: 'activeDays7', label: 'Active days of the last 7', type: 'number', max: 7 },
  { key: 'activeDays28', label: 'Active days of the last 28', type: 'number', max: 28 },
  { key: 'streakDays', label: 'Days in a row', type: 'number', max: 3650 },
  {
    key: 'subscription',
    label: 'Subscription',
    type: 'choice',
    options: ['none', 'active', 'grace_period', 'on_hold', 'paused', 'canceled', 'expired', 'refunded'],
  },
  { key: 'entitlements', label: 'Entitlements', type: 'tags' },
  { key: 'hasPurchased', label: 'Ever purchased', type: 'boolean' },
  { key: 'daysSinceSubscriptionEnded', label: 'Days since subscription ended', type: 'number', max: 3650, nullable: 'none ended' },
  { key: 'language', label: 'Device language', type: 'text', nullable: 'unknown', placeholder: 'de' },
  { key: 'notificationsEnabled', label: 'Notifications on', type: 'boolean', nullable: 'unknown' },
  { key: 'lowMemoryDevice', label: 'Low-memory device', type: 'boolean', nullable: 'unknown' },
  { key: 'localHour', label: 'Local hour', type: 'number', max: 23, nullable: 'unknown' },
  { key: 'installSource', label: 'Install source', type: 'text', nullable: 'unknown', placeholder: 'com.android.vending' },
];

// A typical person who comes now and then, as a starting point
export const SAMPLE_TRAITS = {
  engagement: 'casual',
  daysSinceInstall: 30,
  daysSinceLastVisit: 2,
  activeDays7: 3,
  activeDays28: 9,
  streakDays: 1,
  subscription: 'none',
  entitlements: [],
  hasPurchased: false,
  daysSinceSubscriptionEnded: null,
  language: 'de',
  notificationsEnabled: true,
  lowMemoryDevice: false,
  localHour: 12,
  installSource: null,
};

function show(trait, value) {
  if (value === null || value === undefined) return trait.nullable ?? '—';
  if (trait.type === 'boolean') return value ? 'yes' : 'no';
  if (trait.type === 'tags') return value.length ? value.join(', ') : 'none';
  return String(value);
}

/** The traits of a person as the platform computed them */
export function TraitList({ traits }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs">
      {TRAITS.map((trait) => (
        <div key={trait.key} className="contents">
          <dt className="truncate text-muted-foreground">{trait.label}</dt>
          <dd className={cn('text-right font-mono', (traits[trait.key] === null || traits[trait.key] === undefined) && 'text-muted-foreground')}>
            {show(trait, traits[trait.key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Traits of a person described by hand */
export function TraitInputs({ value, onChange }) {
  const set = (key, next) => onChange({ ...value, [key]: next });

  return (
    <div className="flex flex-col gap-1.5">
      {TRAITS.map((trait) => {
        const current = value[trait.key];
        let input;
        if (trait.type === 'choice') {
          input = (
            <Select mono value={current} onValueChange={(next) => set(trait.key, next)} items={trait.options.map((o) => ({ value: o, label: o }))} />
          );
        } else if (trait.type === 'boolean') {
          const items = [
            { value: 'yes', label: 'yes' },
            { value: 'no', label: 'no' },
            ...(trait.nullable ? [{ value: 'unknown', label: trait.nullable }] : []),
          ];
          input = (
            <Select
              value={current === null ? 'unknown' : current ? 'yes' : 'no'}
              onValueChange={(next) => set(trait.key, next === 'unknown' ? null : next === 'yes')}
              items={items}
            />
          );
        } else if (trait.type === 'number') {
          input = (
            <Input
              mono
              value={current ?? ''}
              placeholder={trait.nullable ?? '0'}
              className="h-7 w-20 text-right"
              onChange={(event) => {
                const text = event.target.value.trim();
                if (text === '') return trait.nullable ? set(trait.key, null) : set(trait.key, 0);
                if (!/^\d+$/.test(text)) return undefined;
                return set(trait.key, Math.min(Number(text), trait.max));
              }}
            />
          );
        } else if (trait.type === 'tags') {
          input = (
            <Input
              mono
              value={current.join(', ')}
              placeholder="premium"
              className="h-7 w-32"
              onChange={(event) => set(trait.key, event.target.value.split(/[\s,]+/).filter(Boolean))}
            />
          );
        } else {
          input = (
            <Input
              mono
              value={current ?? ''}
              placeholder={trait.placeholder}
              className="h-7 w-32"
              onChange={(event) => {
                const text = event.target.value.trim();
                set(trait.key, (trait.key === 'language' ? text.toLowerCase() : text) || null);
              }}
            />
          );
        }
        return (
          <div key={trait.key} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-muted-foreground">{trait.label}</span>
            {input}
          </div>
        );
      })}
    </div>
  );
}
