"use client";
import { Select as S } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact select. items: [{ value, label, disabled? }]
 * Controlled: <Select value={v} onValueChange={setV} items={[...]} />
 * In a form: <Select name="platform" defaultValue="android" items={[...]} /> submits like an input.
 * With label → filter-chip style ("Platform  Both ▾"), 30px.
 */
export function Select({ label, items, value, defaultValue, onValueChange, name, required, disabled, placeholder, mono, className, triggerClassName, "aria-label": ariaLabel }) {
  return (
    <S.Root value={value} defaultValue={defaultValue} onValueChange={onValueChange} items={items} name={name} required={required} disabled={disabled}>
      <S.Trigger aria-label={ariaLabel} className={cn("inline-flex h-[30px] items-center gap-1.5 rounded-md border border-border bg-card pl-2.5 pr-2 text-[13px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 data-[popup-open]:bg-accent data-[disabled]:opacity-50", triggerClassName)}>
        {label && <span className="text-muted-foreground">{label}</span>}
        <S.Value className={cn("font-medium", mono && "font-mono text-xs")}>
          {(selected) => items.find((i) => i.value === selected)?.label ?? placeholder}
        </S.Value>
        <S.Icon><ChevronsUpDown className="size-3.5 text-muted-foreground" /></S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50">
          <S.Popup className={cn("max-h-[var(--available-height)] min-w-[var(--anchor-width)] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 transition-opacity", className)}>
            {items.map((it) => (
              <S.Item key={it.value} value={it.value} disabled={it.disabled}
                className="flex h-8 cursor-default items-center gap-2 rounded-[5px] px-2 text-[13px] outline-none select-none data-[highlighted]:bg-accent data-[disabled]:opacity-50">
                <S.ItemText className={cn("flex-1", mono && "font-mono text-xs")}>{it.label}</S.ItemText>
                <S.ItemIndicator><Check className="size-3.5 text-primary" /></S.ItemIndicator>
              </S.Item>
            ))}
          </S.Popup>
        </S.Positioner>
      </S.Portal>
    </S.Root>
  );
}