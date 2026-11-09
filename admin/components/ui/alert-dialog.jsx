"use client";
import * as React from "react";
import { AlertDialog as A } from "@base-ui/react/alert-dialog";
import { TriangleAlert } from "lucide-react";
import { Button } from "./button";
import { Field } from "./field";
import { Input, Textarea } from "./input";

/**
 * Confirm a destructive action.
 * confirmText: user must type this exact string (e.g. app slug) to enable the button.
 * requireReason: a free-text reason (≥3 chars) is required and passed to onConfirm(reason).
 */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Delete", confirmText, requireReason, reasonPlaceholder, children, onConfirm }) {
  const [typed, setTyped] = React.useState("");
  const [reason, setReason] = React.useState("");
  React.useEffect(() => { if (!open) { setTyped(""); setReason(""); } }, [open]);
  const ok = (!confirmText || typed === confirmText) && (!requireReason || reason.trim().length >= 3);
  return (
    <A.Root open={open} onOpenChange={onOpenChange}>
      <A.Portal>
        <A.Backdrop className="fixed inset-0 z-50 bg-[oklch(0.15_0.02_262/0.45)] transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <A.Popup className="fixed left-1/2 top-1/2 z-50 w-[480px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[10px] border border-border bg-popover shadow-2xl outline-none transition-all data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0">
          <div className="flex gap-3 px-5 pt-[18px]">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive-soft text-destructive"><TriangleAlert className="size-4" /></span>
            <div className="flex flex-col gap-1.5">
              <A.Title className="text-base font-semibold">{title}</A.Title>
              <A.Description className="text-[13px] text-muted-foreground text-pretty">{description}</A.Description>
            </div>
          </div>
          <div className="flex flex-col gap-3 py-4 pl-16 pr-5">
            {children}
            {confirmText && (
              <Field label={<>Type <span className="font-mono">{confirmText}</span> to confirm</>}>
                <Input mono value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </Field>
            )}
            {requireReason && (
              <Field label="Reason" hint="required, saved to the audit log">
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reasonPlaceholder} />
              </Field>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border bg-muted px-5 py-3">
            <A.Close render={<Button variant="outline" />}>Cancel</A.Close>
            <Button variant="destructive" disabled={!ok} onClick={() => { onConfirm?.(reason); onOpenChange?.(false); }}>{confirmLabel}</Button>
          </div>
        </A.Popup>
      </A.Portal>
    </A.Root>
  );
}
