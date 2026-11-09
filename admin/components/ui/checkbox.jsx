"use client";
import { Checkbox as C } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, ...p }) {
  return (
    <C.Root className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-input bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[checked]:border-primary data-[checked]:bg-primary data-[indeterminate]:border-primary data-[indeterminate]:bg-primary", className)} {...p}>
      <C.Indicator className="text-primary-foreground" keepMounted={false}>
        {p.indeterminate ? <Minus className="size-3" strokeWidth={3.5} /> : <Check className="size-3" strokeWidth={3.5} />}
      </C.Indicator>
    </C.Root>
  );
}
