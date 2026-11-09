'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

// A button that asks for confirmation (and a reason, if required) before
// calling a server action. The action receives the reason and returns
// { ok } or { error }; an error stays in the dialog.
export function ConfirmActionButton({
  action,
  label,
  variant = 'destructive-outline',
  size,
  disabled,
  successMessage,
  ...dialog
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();

  async function confirm(reason) {
    const result = await action(reason);
    if (!result?.error && successMessage) {
      toast.add({ title: successMessage });
    }
    return result;
  }

  return (
    <>
      <Button variant={variant} size={size} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} onConfirm={confirm} {...dialog} />
    </>
  );
}