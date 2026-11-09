import { ArrowUp, ArrowDown } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * KPI tile. delta: result of lib/format delta() → { label, up, tone: good|bad|neutral }
 * <MetricTile label="DAU" value="1,243" delta={delta(1243,1180)} sub="vs previous 30 d" definition="…" />
 */
export function MetricTile({ label, value, delta, sub, definition, spark, loading, className }) {
  if (loading) return <div className={cn("flex flex-col gap-2 rounded-lg border border-border bg-card px-3.5 py-3", className)}><Skeleton className="h-3 w-24" /><Skeleton className="h-6 w-20" /><Skeleton className="h-3 w-32" /></div>;
  const tone = delta?.tone === "good" ? "text-success" : delta?.tone === "bad" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-card px-3.5 pb-3 pt-[0.6875rem]", className)}>
      <Tooltip content={definition}><span className="truncate text-xs font-medium text-muted-foreground">{label}</span></Tooltip>
      <div className="flex items-end justify-between gap-2">
        <span className="text-[1.375rem] font-semibold leading-[1.05] tracking-[-0.015em] tabular-nums">{value}</span>
        {spark}
      </div>
      <span className="flex items-center gap-1 truncate text-xs tabular-nums">
        {delta && <span className={cn("inline-flex items-center gap-0.5 font-semibold", tone)}>{delta.up ? <ArrowUp className="size-3" strokeWidth={2.6} /> : <ArrowDown className="size-3" strokeWidth={2.6} />}{delta.label}</span>}
        {sub && <span className="truncate text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}

/** Tiny inline sparkline from an array of numbers. */
export function Sparkline({ values, width = 64, height = 22, className = "stroke-primary" }) {
  if (!values?.length) return null;
  const mn = Math.min(...values), mx = Math.max(...values), g = mx - mn || 1;
  const d = "M" + values.map((v, i) => `${(i * width / (values.length - 1)).toFixed(1)} ${(2 + (height - 4) * (1 - (v - mn) / g)).toFixed(1)}`).join("L");
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0" aria-hidden="true"><path d={d} fill="none" strokeWidth="1.6" className={className} /></svg>;
}
