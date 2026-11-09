"use client";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";
import { cn } from "@/lib/utils";

/** Segmented control (periods, modes). options: [{ value, label, title? }] */
export function Segmented({ options, value, onValueChange, size = "default", className, fill = false }) {
  return (
    <ToggleGroup value={[value]} onValueChange={(v) => v[0] != null && onValueChange(v[0])}
      className={cn("inline-flex gap-0.5 rounded-[7px] border border-border bg-muted p-0.5", fill && "flex w-full", className)}>
      {options.map((o) => (
        <Toggle key={o.value} value={o.value} title={o.title} aria-label={o.title ?? o.label}
          className={cn("whitespace-nowrap rounded-[5px] px-2.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground data-[pressed]:bg-card data-[pressed]:text-foreground data-[pressed]:shadow-[0_0_0_1px_var(--border)] focus-visible:ring-2 focus-visible:ring-ring/40",
            size === "sm" ? "h-[22px]" : "h-6", fill && "flex-1")}>
          {o.icon}{o.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
