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
 * onConfirm may be async: the dialog waits, stays open and shows `error` when the
 * result is { error }, and closes on success.
 */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Delete", pendingLabel = "Working…", confirmText, requireReason, reasonPlaceholder, children, onConfirm }) {
  const [typed, setTyped] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState(null);
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => { if (!open) { setTyped(""); setReason(""); setError(null); } }, [open]);
  const ok = (!confirmText || typed === confirmText) && (!requireReason || reason.trim().length >= 3);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const result = await onConfirm?.(reason.trim());
      if (result?.error) {
        setError(result.error);
        return;
      }
      onOpenChange?.(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <A.Root open={open} onOpenChange={(next) => { if (!pending) onOpenChange?.(next); }}>
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
                <Input mono value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" disabled={pending} />
              </Field>
            )}
            {requireReason && (
              <Field label="Reason" hint="required, saved to the audit log">
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reasonPlaceholder} disabled={pending} />
              </Field>
            )}
            {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-border bg-muted px-5 py-3">
            <A.Close render={<Button variant="outline" disabled={pending} />}>Cancel</A.Close>
            <Button variant="destructive" disabled={!ok || pending} onClick={confirm}>{pending ? pendingLabel : confirmLabel}</Button>
          </div>
        </A.Popup>
      </A.Portal>
    </A.Root>
  );
}