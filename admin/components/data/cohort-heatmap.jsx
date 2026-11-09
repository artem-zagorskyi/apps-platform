import { cn } from "@/lib/utils";
import { num } from "@/lib/format";

/**
 * Retention / renewal cohorts. columns: ["D1","D7",…], rows: [{ label, size, values: [pct|null] }]
 * null = not enough time has passed (empty cell). thresholds map % to heat-0…5.
 */
export function CohortHeatmap({ columns, rows, firstHeader = "Cohort", sizeHeader = "Users", thresholds = [20, 35, 45, 55, 65], minWidth = 640 }) {
  const level = (v) => thresholds.reduce((l, t) => (v >= t ? l + 1 : l), 0);
  const tpl = `130px 80px repeat(${columns.length}, minmax(56px,1fr))`;
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }}>
        <div className="grid h-8 items-center border-t border-border bg-muted pl-4 pr-3 text-xs font-medium text-muted-foreground" style={{ gridTemplateColumns: tpl }}>
          <span>{firstHeader}</span><span className="pr-3 text-right">{sizeHeader}</span>{columns.map((c) => <span key={c} className="text-center">{c}</span>)}
        </div>
        {rows.map((r) => (
          <div key={r.label} className="grid h-[34px] items-center border-t border-border pl-4 pr-3 text-xs tabular-nums" style={{ gridTemplateColumns: tpl }}>
            <span className="text-[13px] font-medium">{r.label}</span><span className="pr-3 text-right text-muted-foreground">{num(r.size)}</span>
            {r.values.map((v, i) => {
              const l = v == null ? -1 : level(v);
              return (
                <span key={i} title={v == null ? "Not enough time has passed" : `${r.label} · ${columns[i]}: ${v.toFixed(1)}%`}
                  className={cn("mx-px flex h-7 items-center justify-center rounded font-medium", l >= 4 ? "text-[var(--heat-ink,var(--primary-foreground))]" : "text-foreground")}
                  style={{ background: l < 0 ? "transparent" : `var(--heat-${l})` }}>
                  {v == null ? "" : Math.round(v) + "%"}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
