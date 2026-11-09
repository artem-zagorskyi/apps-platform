'use client';

import { useActionState } from 'react';
import { KeyRound } from 'lucide-react';
import { SecretOnce } from '@/components/data/secret-once';
import { Button } from '@/components/ui/button';

// Creates a backend key and shows its private half once
export function CreateKeyForm({ action }) {
  const [state, formAction, pending] = useActionState(action, null);
  const key = state?.data;

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <Button type="submit" disabled={pending}>
          <KeyRound />
          {pending ? 'Creating…' : 'Create key'}
        </Button>
      </form>
      {state?.error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {state.error}
        </p>
      )}
      {key && (
        <SecretOnce
          title={`Key ${key.kid} created`}
          description="Put this line into the app backend's .env now."
          value={`PLATFORM_IDENTITY_KEY=${key.privateKey}`}
        />
      )}
    </div>
  );
}