'use client';

import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { cn } from '@/lib/utils';

const PLATFORMS = ['android', 'ios'];

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
          <MenuContent>
            {free.map((field) => (
              <MenuItem
                key={field.key}
                onClick={() => {
                  set(field.key, initial(field));
                  setOpen(field.key);
                }}
              >
                {field.label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      )}
    </span>
  );
}
