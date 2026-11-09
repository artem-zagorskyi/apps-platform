import { Info, TriangleAlert, CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const T = {
  info: ["border-border bg-muted", "text-muted-foreground", Info],
  warning: ["border-warning/50 bg-warning-soft", "text-warning", TriangleAlert],
  destructive: ["border-destructive/50 bg-destructive-soft", "text-destructive", CircleAlert],
  success: ["border-success/40 bg-success-soft", "text-success", CircleCheck],
};

export function Callout({ tone = "info", title, children, action, className }) {
  const [box, ink, Icon] = T[tone];
  return (
    <div role={tone === "destructive" ? "alert" : undefined} className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]", box, className)}>
      <Icon className={cn("mt-px size-4 shrink-0", ink)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-pretty">{title && <b className="font-semibold">{title}</b>}{children && <span className={title ? "text-muted-foreground" : ""}>{children}</span>}</div>
      {action}
    </div>
  );
}
