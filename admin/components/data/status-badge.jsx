import { Badge } from "@/components/ui/badge";

/** One mapping for every state shown in the admin. */
const MAP = {
  ok: ["success", "OK"], healthy: ["success", "healthy"], running: ["primary", "running"], delivered: ["success", "delivered"], processed: ["success", "processed"], live: ["success", "live"], active: ["success", "active"],
  warning: ["warning", "warning"], retrying: ["warning", "retrying"], grace: ["warning", "grace period"], unknown: ["warning", "unknown"],
  failed: ["destructive", "failed"], error: ["destructive", "error"], srm: ["destructive", "SRM"], overdue: ["solidDestructive", "overdue"],
  draft: ["neutral", "draft"], stopped: ["neutral", "stopped"], ignored: ["neutral", "ignored"], waiting: ["neutral", "waiting"], scheduled: ["neutral", "scheduled"], disabled: ["outline", "disabled"],
};
export function StatusBadge({ status, label, dot = true, ...p }) {
  const [tone, text] = MAP[status] ?? ["neutral", status];
  return <Badge tone={tone} dot={dot && tone !== "solidDestructive"} {...p}>{label ?? text}</Badge>;
}
