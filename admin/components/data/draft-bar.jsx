import { Pencil, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Sticky bar while a config draft exists. Nothing reaches users until publish. */
export function DraftBar({ count, baseVersion, errors = 0, onDiscard, onReview }) {
  if (!count) return null;
  return (
    <div className="sticky top-2 z-[4] flex flex-wrap items-center gap-2.5 rounded-lg border border-primary bg-primary-soft py-2 pl-3.5 pr-2 text-[13px]">
      <Pencil className="size-4 text-primary" />
      <span className="text-primary-soft-foreground"><b className="font-semibold">Draft: {count} changes</b> on top of v{baseVersion}. Nothing reaches users until you publish.</span>
      {errors > 0 && <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive"><CircleAlert className="size-3.5" />{errors} error{errors > 1 ? "s" : ""}</span>}
      <div className="ml-auto flex gap-1.5">
        <Button variant="ghost" className="text-primary-soft-foreground hover:bg-card" onClick={onDiscard}>Discard</Button>
        <Button onClick={onReview}>Review &amp; publish</Button>
      </div>
    </div>
  );
}

/** Field-by-field diff value pair. */
export function DiffValue({ from, to }) {
  return (
    <span className="flex flex-wrap items-center gap-2 font-mono text-xs leading-relaxed">
      <span className="rounded bg-destructive-soft px-1.5 line-through decoration-destructive">{from}</span>
      <span className="text-muted-foreground">→</span>
      <span className="max-w-[420px] truncate rounded bg-success-soft px-1.5">{to}</span>
    </span>
  );
}
