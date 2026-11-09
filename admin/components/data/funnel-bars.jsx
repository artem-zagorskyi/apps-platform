import { ArrowDown } from "lucide-react";
import { num } from "@/lib/format";

/**
 * Horizontal funnel. steps: [{ event, condition? , median? }]
 * groups: [{ label, color: "var(--chart-1)", values: [n0, n1, …] }] (one group = no comparison)
 */
export function FunnelBars({ steps, groups }) {
  const max = Math.max(1, ...groups.map((g) => g.values[0] ?? 0));
  const multi = groups.length > 1;
  return (
    <div className="flex flex-col">
      {steps.map((s, i) => {
        const cur = groups.reduce((a, g) => a + (g.values[i] ?? 0), 0);
        const prev = i ? groups.reduce((a, g) => a + (g.values[i - 1] ?? 0), 0) : 0;
        return (
          <div key={i} className="flex flex-col gap-1.5">
            {i > 0 && (
              <div className="flex flex-wrap gap-[18px] py-1.5 pl-7 text-xs text-muted-foreground tabular-nums">
                <span className="inline-flex items-center gap-1"><ArrowDown className="size-3" strokeWidth={2.4} />{num(prev - cur)} dropped · {prev ? (((prev - cur) / prev) * 100).toFixed(1) : "0"}%</span>
                {s.median && <span>Median time from previous step <b className="font-medium text-foreground">{s.median}</b></span>}
              </div>
            )}
            <div className="grid grid-cols-[20px_minmax(140px,220px)_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
              <span className="flex size-5 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary-soft-foreground">{i + 1}</span>
              <span className="flex min-w-0 flex-col"><span className="truncate font-mono text-xs font-medium">{s.event}</span>{s.condition && <span className="font-mono text-[11px] text-muted-foreground">where {s.condition}</span>}</span>
              <div className="flex flex-col gap-1">
                {groups.map((g) => {
                  const v = g.values[i] ?? 0, p = g.values[i - 1];
                  return (
                    <div key={g.label} className="flex items-center gap-2.5">
                      <div className="flex-1 overflow-hidden rounded bg-muted" style={{ height: multi ? 14 : 22 }}>
                        <div className="h-full rounded" style={{ width: `${(v / max) * 100}%`, background: g.color }} />
                      </div>
                      <span className="flex w-[150px] shrink-0 justify-end gap-2 text-xs tabular-nums"><b className="font-semibold">{num(v)}</b><span className="w-[52px] text-right text-muted-foreground">{i === 0 ? "100%" : p ? ((v / p) * 100).toFixed(1) + "%" : "—"}</span></span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
