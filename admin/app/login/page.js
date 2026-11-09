import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · Renvix Apps Platform' };

export default async function LoginPage() {
  if (await getSession()) {
    redirect('/');
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 py-10">
      <LoginForm />
      <p className="text-xs text-muted-foreground">Internal tool of Renvix. Access is by invitation.</p>
    </main>
  );
}