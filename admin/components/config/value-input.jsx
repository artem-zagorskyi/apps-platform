'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const UNSET = '__unset__';

/**
 * Input for one parameter value, by its declared type.
 * value: the value or undefined (not set); onChange(next | undefined).
 * allowUnset: offers "not set" (server value); off for force and rule values.
 */
export function ValueInput({ definition, value, onChange, allowUnset = false, disabled, invalid, className }) {
  const type = definition?.type;

  if (type === 'boolean' || type === 'enum') {
    const options = type === 'boolean' ? ['true', 'false'] : definition.values;
    const items = [
      ...(allowUnset ? [{ value: UNSET, label: '— built-in' }] : []),
      ...options.map((option) => ({ value: option, label: option })),
    ];
    const current = value === undefined ? (allowUnset ? UNSET : undefined) : String(value);
    return (
      <span className={cn(disabled && 'pointer-events-none opacity-60', className)}>
        <Select
          mono
          items={items}
          value={current}
          placeholder="choose"
          onValueChange={(next) => {
            if (next === UNSET) onChange(undefined);
            else onChange(type === 'boolean' ? next === 'true' : next);
          }}
        />
      </span>
    );
  }

  return (
    <TextValue
      numeric={type === 'integer' || type === 'number'}
      value={value}
      onChange={onChange}
      allowUnset={allowUnset}
      disabled={disabled}
      invalid={invalid}
      maxLength={type === 'string' ? definition.max_length : undefined}
      className={className}
    />
  );
}

// Numbers are typed as text and parsed, so "1." or "-" can be typed on the way
function TextValue({ numeric, value, onChange, allowUnset, disabled, invalid, maxLength, className }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));

  // A value changed from outside (Raw JSON) shows up here
  useEffect(() => {
    setText((current) => {
      const parsed = current === '' ? undefined : numeric ? Number(current) : current;
      return parsed === value ? current : value === undefined ? '' : String(value);
    });
  }, [value, numeric]);

  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Input
        mono
        value={text}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        inputMode={numeric ? 'decimal' : undefined}
        placeholder={allowUnset ? '— built-in' : numeric ? '0' : 'text'}
        className={numeric ? 'w-28' : 'min-w-0 flex-1'}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (next === '') onChange(allowUnset ? undefined : numeric ? Number.NaN : '');
          else onChange(numeric ? Number(next) : next);
        }}
      />
      {maxLength !== undefined && (
        <span className={cn('shrink-0 text-xs tabular-nums', text.length > maxLength ? 'text-destructive' : 'text-muted-foreground')}>
          {text.length}/{maxLength}
        </span>
      )}
    </span>
  );
}
