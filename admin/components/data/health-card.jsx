import { Check, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Experiment health (SRM, cross-exposure) or system check. status: ok | warn | fail */
export function HealthCard({ status = "ok", label, value, note }) {
  const s = { ok: ["bg-success-soft text-success", "border-border", Check], warn: ["bg-warning-soft text-warning", "border-warning", TriangleAlert], fail: ["bg-destructive-soft text-destructive", "border-destructive", X] }[status];
  const Icon = s[2];
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border bg-card px-3.5 py-3", s[1])}>
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-[0.4375rem]", s[0])}><Icon className="size-[0.9375rem]" strokeWidth={2.4} /></span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-[0.9375rem] font-semibold tabular-nums">{value}</span>
        {note && <span className="text-xs text-muted-foreground text-pretty">{note}</span>}
      </div>
    </div>
  );
}

/** "Needs attention" row (System → Status). severity: critical | warning */
export function AlertRow({ severity = "warning", text, meta, app, onView }) {
  const crit = severity === "critical";
  return (
    <div className="flex min-h-10 items-center gap-2.5 border-t border-border px-4 py-1.5 text-[0.8125rem] hover:bg-accent">
      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", crit ? "bg-destructive-soft text-destructive" : "bg-warning-soft text-warning")}><TriangleAlert className="size-3.5" /></span>
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2"><span>{text}</span>{meta && <span className="text-xs text-muted-foreground">{meta}</span>}</span>
      {app && <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2 rounded-sm" style={{ background: app.color }} />{app.name}</span>}
      {onView && <button onClick={onView} className="shrink-0 text-[0.8125rem] font-medium text-primary-soft-foreground hover:underline">View ›</button>}
    </div>
  );
}
