import { CircleAlert, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState({ icon: Icon = Inbox, title, children, action, className = "" }) {
  return (
    <div className={"flex max-w-[42.5rem] flex-col items-start gap-2.5 rounded-lg border border-border bg-card px-7 py-8 " + className}>
      <span className="flex size-9 items-center justify-center rounded-[0.5625rem] bg-muted text-muted-foreground"><Icon className="size-[1.125rem]" /></span>
      <span className="text-base font-semibold">{title}</span>
      {children && <p className="text-[0.8125rem] text-muted-foreground text-pretty">{children}</p>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}

/** Inline row inside a table/card when there is nothing to show. */
export function EmptyRow({ children }) {
  return <div className="border-t border-border px-4 py-5 text-[0.8125rem] text-muted-foreground">{children}</div>;
}

export function ErrorState({ title = "Couldn\u2019t load this block", detail, onRetry }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-lg border border-destructive bg-destructive-soft px-4 py-3 text-[0.8125rem]">
      <CircleAlert className="size-4 shrink-0 text-destructive" />
      <div className="flex flex-1 flex-col"><b className="font-semibold">{title}</b>{detail && <span className="font-mono text-xs text-muted-foreground">{detail}</span>}</div>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
