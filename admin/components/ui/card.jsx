import { cn } from "@/lib/utils";

export function Card({ className, ...p }) {
  return <section className={cn("overflow-hidden rounded-lg border border-border bg-card text-card-foreground", className)} {...p} />;
}
export function CardHeader({ title, description, actions, className, children }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-4 py-3", className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {title && <h2 className="text-sm font-semibold">{title}</h2>}
        {description && <p className="text-xs text-muted-foreground text-pretty">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
export function CardBody({ className, ...p }) { return <div className={cn("px-4 pb-4", className)} {...p} />; }
export function CardFooter({ className, ...p }) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-border bg-muted px-4 py-3", className)} {...p} />;
}
