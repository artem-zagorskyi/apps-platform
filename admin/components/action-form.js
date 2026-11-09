'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

// A form bound to a server action that returns { ok } or { error }.
// Errors stay under the form; success shows a toast.
// inline: the controls and the button share one row.
// onSuccess(state): called once per successful submit, e.g. to show returned data.
export function ActionForm({
  action,
  submitLabel,
  pendingLabel = 'Saving…',
  successMessage = 'Saved',
  variant = 'default',
  inline = false,
  onSuccess,
  className,
  children,
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const toast = useToast();
  // Every submit returns a new state object; toast each success once
  const announced = useRef(null);

  useEffect(() => {
    if (state?.ok && announced.current !== state) {
      announced.current = state;
      toast.add({ title: successMessage });
      onSuccess?.(state);
    }
  }, [state, toast, successMessage, onSuccess]);

  const button = (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? pendingLabel : submitLabel}
    </Button>
  );

  return (
    <form action={formAction} className={cn('flex flex-col gap-2', className)}>
      {inline ? (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">{children}</div>
          {button}
        </div>
      ) : (
        <>
          {children}
          <div>{button}</div>
        </>
      )}
      {state?.error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}