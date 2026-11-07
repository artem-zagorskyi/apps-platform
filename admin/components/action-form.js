'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';

// A form bound to a server action that returns { ok } or { error }
export function ActionForm({ action, submitLabel, variant = 'default', children }) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="grid gap-2">
      {children}
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && !pending && (
        <p role="status" className="text-sm text-muted-foreground">
          Saved.
        </p>
      )}
      <div>
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}