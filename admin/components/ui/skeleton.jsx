import { cn } from "@/lib/utils";
export const Skeleton = ({ className, ...p }) => <div className={cn("animate-pulse rounded-md bg-muted", className)} {...p} />;
export const Kbd = ({ className, ...p }) => <kbd className={cn("inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground", className)} {...p} />;
