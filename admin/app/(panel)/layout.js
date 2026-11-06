import { Button } from '@/components/ui/button';
import { requireSession } from '@/lib/session';
import { signOut } from './actions';

// Every page in this group needs a live admin session
export default async function PanelLayout({ children }) {
  const session = await requireSession();

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-semibold">Apps Platform</span>
        <form action={signOut} className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{session.email}</span>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}