"use client";
import { Dialog as D } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const backdrop = "fixed inset-0 z-50 bg-[oklch(0.15_0.02_262/0.45)] transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

/** Centered modal: title, description, body (children), footer. */
export function DialogContent({ title, description, footer, width = 480, className, children }) {
  return (
    <D.Portal>
      <D.Backdrop className={backdrop} />
      <D.Popup style={{ width }} className={cn("fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-3rem)] max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[0.625rem] border border-border bg-popover text-popover-foreground shadow-2xl outline-none transition-all data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0", className)}>
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="flex flex-1 flex-col gap-1">
            <D.Title className="text-[0.9375rem] font-semibold">{title}</D.Title>
            {description && <D.Description className="text-[0.8125rem] text-muted-foreground text-pretty">{description}</D.Description>}
          </div>
          <D.Close aria-label="Close" className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></D.Close>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4 text-[0.8125rem]">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border bg-muted px-5 py-3">{footer}</div>}
      </D.Popup>
    </D.Portal>
  );
}

/** Right-side sheet (parameter editor, user details). */
export function SheetContent({ title, subtitle, headerExtra, footer, width = 520, children }) {
  return (
    <D.Portal>
      <D.Backdrop className={cn(backdrop, "bg-[oklch(0.15_0.02_262/0.35)]")} />
      <D.Popup style={{ width }} className="fixed inset-y-0 right-0 z-50 flex max-w-full flex-col border-l border-border bg-popover shadow-2xl outline-none transition-transform data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full">
        <div className="flex items-start gap-2.5 border-b border-border px-[1.125rem] py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <D.Title className="font-mono text-[0.9375rem] font-semibold">{title}</D.Title>
            {subtitle && <D.Description className="text-xs text-muted-foreground">{subtitle}</D.Description>}
          </div>
          {headerExtra}
          <D.Close aria-label="Close" className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></D.Close>
        </div>
        <div className="flex flex-1 flex-col gap-[1.125rem] overflow-auto px-[1.125rem] py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border bg-muted px-[1.125rem] py-3">{footer}</div>}
      </D.Popup>
    </D.Portal>
  );
}
