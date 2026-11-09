'use client';

import { useActionState } from 'react';
import { CircleAlert, Lock } from 'lucide-react';
import { Logo } from '@/components/shell/logo';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { signIn } from './actions';

// The API answers a wrong email, password or code the same way, and so does the form
const NOTICES = {
  invalid: {
    icon: CircleAlert,
    tone: 'destructive',
    title: 'Wrong email, password or code',
    detail: 'After 5 failed attempts in a row the account is locked for 15 minutes.',
  },
  locked: {
    icon: Lock,
    tone: 'warning',
    title: 'Too many failed attempts',
    detail: 'The account is locked for 15 minutes. Waiting does not need any action.',
  },
  rate: {
    icon: CircleAlert,
    tone: 'warning',
    title: 'Too many attempts from this address',
    detail: 'Wait a minute and try again.',
  },
};

function Notice({ kind }) {
  const { icon: Icon, tone, title, detail } = NOTICES[kind];
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-[7px] px-3 py-2.5 text-[13px]',
        tone === 'destructive' ? 'bg-destructive-soft' : 'bg-warning-soft',
      )}
    >
      <Icon className={cn('mt-px size-4 shrink-0', tone === 'destructive' ? 'text-destructive' : 'text-warning')} />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
    </div>
  );
}

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, null);
  const invalid = state?.error === 'invalid' || undefined;

  return (
    <form
      action={formAction}
      className="flex w-[380px] max-w-full flex-col gap-[18px] rounded-[10px] border border-border bg-card px-7 pb-6 pt-7"
    >
      <div className="flex flex-col items-start gap-3.5">
        <Logo size={32} />
        <div className="flex flex-col gap-[3px]">
          <h1 className="text-lg font-semibold tracking-[-0.015em]">Renvix Apps Platform</h1>
          <p className="text-[13px] text-muted-foreground">Sign in to the admin panel</p>
        </div>
      </div>

      {state?.error && <Notice kind={state.error} />}

      <div className="flex flex-col gap-3">
        <Field label="Email">
          <Input
            name="email"
            type="email"
            autoComplete="username"
            defaultValue={state?.email}
            required
            disabled={pending}
            aria-invalid={invalid}
            className="h-9"
          />
        </Field>
        <Field label="Password">
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={pending}
            aria-invalid={invalid}
            className="h-9"
          />
        </Field>
        <Field
          label="Code"
          description={
            <>
              6 digits from your authenticator app, or a backup code like{' '}
              <span className="font-mono">K7QM-2XPA-9RTD-4HNB</span>
            </>
          }
        >
          <Input
            name="code"
            autoComplete="one-time-code"
            placeholder="123456"
            required
            disabled={pending}
            aria-invalid={invalid}
            className="h-9 font-mono text-[15px] tracking-[0.12em]"
          />
        </Field>
      </div>

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending && (
          <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
        )}
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}