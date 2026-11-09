import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** One topic per card: title, one line of description, actions on the right. */
export function SettingsCard({ title, description, actions, className, children }) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} actions={actions} />
      {children}
    </Card>
  );
}

/** Padded body area for forms inside a card. */
export function CardSection({ className, border = true, ...p }) {
  return <div className={cn("flex flex-col gap-3 px-4 py-3.5", border && "border-t border-border", className)} {...p} />;
}

/** Tab content column. */
export function SettingsColumn({ children }) {
  return <div className="flex w-full max-w-[760px] flex-col gap-4">{children}</div>;
}

/** label → value rows. items: [{ label, value, mono? }] */
export function KeyValueList({ items }) {
  return (
    <dl className="grid grid-cols-[150px_minmax(0,1fr)] border-t border-border text-[13px]">
      {items.map((it, i) => (
        <div key={i} className="contents">
          <dt className="border-b border-border px-4 py-2.5 text-muted-foreground last-of-type:border-b-0">{it.label}</dt>
          <dd className={cn("flex min-w-0 items-center gap-2 border-b border-border px-4 py-2", it.mono && "font-mono text-xs")}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}