import { Tooltip } from "@/components/ui/tooltip";

/** Where a number comes from. kind: "analytics" | "store" | "technical" */
export function SourceTag({ kind = "analytics", rate, label }) {
  const text = label ?? (kind === "analytics" ? `Analytics · ${rate}%` : kind === "store" ? "Store · all users" : "Technical");
  const tip = kind === "analytics" ? `Only people who consented to analytics (${rate}% of active users)` : kind === "store" ? "Counted from store purchases and notifications, all users, no consent needed" : "From technical logs, all users";
  return (
    <Tooltip content={tip}>
      <span className="whitespace-nowrap rounded border border-border px-[0.3125rem] py-[0.1875rem] font-mono text-[0.625rem] font-medium leading-none text-muted-foreground">{text}</span>
    </Tooltip>
  );
}
