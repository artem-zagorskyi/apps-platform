'use client';

import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { cn } from '@/lib/utils';

const PLATFORMS = ['android', 'ios'];

// Sections of the "+ condition" menu
const GROUPS = [
  { key: 'user', label: 'User' },
  { key: 'activity', label: 'Activity' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'device', label: 'Device' },
];

// Why a condition may not match some people
const NEEDS = {
  personalization: 'Only for people who allowed personalization (P)',
  personalization_analytics: 'Only for people who allowed personalization and analytics (P+A)',
};

// Default value of a newly added condition
function initial(field) {
  switch (field.kind) {
    case 'platforms':
      return ['android'];
    case 'version':
      return '1.0.0';
    case 'countries':
      return ['DE'];
    case 'boolean':
      return true;
    case 'user_ids':
      return [];
    case 'range':
      return { min: field.bounds?.min ?? 0 };
    case 'choice':
      return [field.options[0]];
    case 'tags':
      return [];
    default:
      return undefined;
  }
}

// "Linked account is yes", "Country is DE, AT"
export function conditionSummary(field, value) {
  switch (field.kind) {
    case 'platforms':
      return `${field.label} is ${value.join(' or ')}`;
    case 'version':
      return `${field.label} ${value}`;
    case 'countries':
      return `${field.label} is ${value.join(', ')}`;
    case 'boolean':
      return `${field.label} is ${value ? 'yes' : 'no'}`;
    case 'user_ids':
      return `${value.length} user ID${value.length === 1 ? '' : 's'}`;
    case 'range':
      if (value.min !== undefined && value.max !== undefined) return `${field.label} ${value.min}–${value.max}`;
      return value.min !== undefined ? `${field.label} ≥ ${value.min}` : `${field.label} ≤ ${value.max}`;
    case 'choice':
      return `${field.label} is ${value.join(' or ')}`;
    case 'tags':
      return value.length ? `${field.label}: ${value.join(', ')}` : `${field.label}: …`;
    default:
      return field.label;
  }
}

function FieldInput({ field, value, onChange, disabled }) {
  const [text, setText] = useState(() => (Array.isArray(value) ? value.join(field.kind === 'user_ids' ? '\n' : ', ') : ''));

  switch (field.kind) {
    case 'platforms':
      return (
        <span className="inline-flex gap-1">
          {PLATFORMS.map((platform) => {
            const on = value.includes(platform);
            return (
              <button
                key={platform}
                type="button"
                disabled={disabled}
                onClick={() => {
                  const next = on ? value.filter((item) => item !== platform) : [...value, platform];
                  if (next.length > 0) onChange(next);
                }}
                className={cn(
                  'h-6 rounded-[0.3125rem] border px-2 font-mono text-xs',
                  on ? 'border-primary bg-primary-soft text-primary-soft-foreground' : 'border-border text-muted-foreground',
                )}
              >
                {platform}
              </button>
            );
          })}
        </span>
      );
    case 'version':
      return (
        <Input mono value={value} disabled={disabled} className="h-7 w-24" onChange={(event) => onChange(event.target.value.trim())} />
      );
    case 'countries':
      return (
        <Input
          mono
          value={text}
          disabled={disabled}
          placeholder="DE, AT"
          className="h-7 w-40"
          onChange={(event) => {
            setText(event.target.value);
            onChange(
              event.target.value
                .split(/[\s,]+/)
                .map((code) => code.trim().toUpperCase())
                .filter(Boolean),
            );
          }}
        />
      );
    case 'boolean':
      return (
        <span className="inline-flex gap-1">
          {[true, false].map((option) => (
            <button
              key={String(option)}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option)}
              className={cn(
                'h-6 rounded-[0.3125rem] border px-2 text-xs',
                value === option ? 'border-primary bg-primary-soft text-primary-soft-foreground' : 'border-border text-muted-foreground',
              )}
            >
              {option ? 'yes' : 'no'}
            </button>
          ))}
        </span>
      );
    case 'range': {
      // An empty box removes that bound
      const bound = (key, text) => {
        const next = { ...value };
        if (text.trim() === '') delete next[key];
        else if (/^\d+$/.test(text.trim())) next[key] = Number(text);
        else return;
        onChange(next);
      };
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          from
          <Input mono value={value.min ?? ''} disabled={disabled} className="h-7 w-16" placeholder="any" onChange={(event) => bound('min', event.target.value)} />
          to
          <Input mono value={value.max ?? ''} disabled={disabled} className="h-7 w-16" placeholder="any" onChange={(event) => bound('max', event.target.value)} />
          {field.bounds && (
            <span>
              ({field.bounds.min}–{field.bounds.max}
              {field.key === 'local_hour' && ', 22 to 6 goes over midnight'})
            </span>
          )}
        </span>
      );
    }
    case 'choice':
      return (
        <span className="inline-flex flex-wrap gap-1">
          {field.options.map((option) => {
            const on = value.includes(option);
            return (
              <button
                key={option}
                type="button"
                disabled={disabled}
                onClick={() => {
                  const next = on ? value.filter((item) => item !== option) : [...value, option];
                  if (next.length > 0) onChange(next);
                }}
                className={cn(
                  'h-6 rounded-[0.3125rem] border px-2 font-mono text-xs',
                  on ? 'border-primary bg-primary-soft text-primary-soft-foreground' : 'border-border text-muted-foreground',
                )}
              >
                {option}
              </button>
            );
          })}
        </span>
      );
    case 'tags':
      return (
        <Input
          mono
          value={text}
          disabled={disabled}
          placeholder={field.key === 'languages' ? 'de, en' : field.key === 'entitlements' ? 'premium' : 'any of, comma separated'}
          className="h-7 w-48"
          onChange={(event) => {
            setText(event.target.value);
            onChange(
              event.target.value
                .split(/[\s,]+/)
                .map((item) => item.trim())
                .filter(Boolean),
            );
          }}
        />
      );
    case 'user_ids':
      return (
        <textarea
          value={text}
          disabled={disabled}
          rows={3}
          placeholder="One user ID per line"
          className="w-full rounded-md border border-input bg-card px-2 py-1 font-mono text-xs outline-none focus-visible:border-ring"
          onChange={(event) => {
            setText(event.target.value);
            onChange(event.target.value.split(/\s+/).filter(Boolean));
          }}
        />
      );
    default:
      return null;
  }
}

/**
 * The conditions of one rule (or a targeting).
 * fields: [{ key, label, kind }] from the server; condition: { key: value }
 */
export function ConditionEditor({ fields, condition, onChange, disabled }) {
  const [open, setOpen] = useState(null);
  const used = fields.filter((field) => condition[field.key] !== undefined);
  const free = fields.filter((field) => condition[field.key] === undefined);

  const set = (key, value) => onChange({ ...condition, [key]: value });
  const remove = (key) => {
    const next = { ...condition };
    delete next[key];
    onChange(next);
  };

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {used.map((field) =>
        open === field.key ? (
          <span key={field.key} className="flex w-full flex-wrap items-center gap-2 rounded-md border border-ring bg-card px-2 py-1.5 text-xs">
            <span className="font-medium">{field.label}</span>
            <FieldInput field={field} value={condition[field.key]} onChange={(value) => set(field.key, value)} disabled={disabled} />
            <button type="button" onClick={() => setOpen(null)} className="ml-auto text-xs font-medium text-primary-soft-foreground">
              Done
            </button>
          </span>
        ) : (
          <span
            key={field.key}
            className="inline-flex h-6 items-center gap-1 rounded-[0.3125rem] border border-border bg-muted pl-2 pr-1 text-xs"
          >
            <button type="button" disabled={disabled} onClick={() => setOpen(field.key)} className="hover:underline">
              {conditionSummary(field, condition[field.key])}
            </button>
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${field.label}`}
                onClick={() => remove(field.key)}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ),
      )}
      {!disabled && free.length > 0 && (
        <Menu>
          <MenuTrigger className="inline-flex h-6 items-center gap-1 rounded-[0.3125rem] border border-dashed border-border px-2 text-xs text-muted-foreground hover:bg-accent">
            <Plus className="size-3" />
            condition
          </MenuTrigger>
          <MenuContent className="max-h-[22rem] overflow-y-auto">
            {GROUPS.map((group, index) => {
              const items = free.filter((field) => (field.group ?? 'user') === group.key);
              if (items.length === 0) return null;
              return (
                <span key={group.key}>
                  {index > 0 && <MenuSeparator />}
                  <span className="block px-2 pb-0.5 pt-1 text-[0.6875rem] font-medium text-muted-foreground">{group.label}</span>
                  {items.map((field) => (
                    <MenuItem
                      key={field.key}
                      title={NEEDS[field.needs]}
                      onClick={() => {
                        set(field.key, initial(field));
                        setOpen(field.key);
                      }}
                    >
                      {field.label}
                      {field.needs && <span className="ml-auto pl-3 text-[0.6875rem] text-muted-foreground">{field.needs === 'personalization' ? 'P' : 'P+A'}</span>}
                    </MenuItem>
                  ))}
                </span>
              );
            })}
            <span className="block border-t border-border px-2 pb-1 pt-1.5 text-[0.6875rem] text-muted-foreground">
              P: only with personalization consent · P+A: also analytics
            </span>
          </MenuContent>
        </Menu>
      )}
    </span>
  );
}
