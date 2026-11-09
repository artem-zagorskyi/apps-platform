"use client";
import { Switch as S } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

export function Switch({ tone = "primary", className, ...p }) {
  return (
    <S.Root className={cn("inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-input p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 data-[disabled]:opacity-50",
      tone === "warning" ? "data-[checked]:bg-warning" : "data-[checked]:bg-primary", className)} {...p}>
      <S.Thumb className="size-4 rounded-full bg-card shadow-sm transition-transform data-[checked]:translate-x-4" />
    </S.Root>
  );
}
