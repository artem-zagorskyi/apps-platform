import { cn } from "@/lib/utils";

/**
 * Confidence interval around zero for experiment metrics.
 * lift, lo, hi in %; range = ±30 by default. lowerIsBetter flips the color logic.
 */
export function CiBar({ lift, lo, hi, range = 30, lowerIsBetter = false }) {
  const pos = (v) => Math.max(0, Math.min(100, ((v + range) / (2 * range)) * 100));
  const sig = lo > 0 || hi < 0;
  const good = lowerIsBetter ? hi < 0 : lo > 0;
  const color = sig ? (good ? "var(--success)" : "var(--destructive)") : "var(--primary)";
  return (
    <div className="relative h-[1.375rem]" title={`95% interval: ${lo.toFixed(1)}% … ${hi > 0 ? "+" : ""}${hi.toFixed(1)}%`}>
      <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
      <div className="absolute inset-y-0.5 left-1/2 w-px bg-muted-foreground" />
      <div className="absolute top-2 h-1.5 rounded-full" style={{ left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%`, background: color }} />
      <div className="absolute top-[0.3125rem] -ml-1.5 size-3 rounded-full border-2 bg-card" style={{ left: `${pos(lift)}%`, borderColor: color }} />
    </div>
  );
}

export function liftTone(lo, hi, lowerIsBetter = false) {
  if (!(lo > 0 || hi < 0)) return "text-foreground";
  return (lowerIsBetter ? hi < 0 : lo > 0) ? "text-success" : "text-destructive";
}
