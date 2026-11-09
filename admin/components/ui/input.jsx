"use client";
import * as React from "react";
import { Input as BaseInput } from "@base-ui/react/input";
import { cn } from "@/lib/utils";

const base = "w-full rounded-md border border-input bg-card px-2.5 text-[0.8125rem] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive disabled:opacity-50";

export const Input = React.forwardRef(function Input({ className, mono, ...p }, ref) {
  return <BaseInput ref={ref} className={cn(base, "h-8", mono && "font-mono text-xs", className)} {...p} />;
});

export const Textarea = React.forwardRef(function Textarea({ className, mono, ...p }, ref) {
  return <textarea ref={ref} className={cn(base, "min-h-16 resize-y py-2", mono && "font-mono text-xs leading-relaxed", className)} {...p} />;
});

/** Search box with icon, 1.875rem, used in table toolbars. */
export function SearchInput({ className, ...p }) {
  return (
    <label className={cn("flex h-[1.875rem] items-center gap-2 rounded-md border border-input bg-card px-2.5 focus-within:border-ring", className)}>
      <svg className="size-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input className="min-w-0 flex-1 bg-transparent text-[0.8125rem] outline-none placeholder:text-muted-foreground" {...p} />
    </label>
  );
}
