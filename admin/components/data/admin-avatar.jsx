import { Terminal } from 'lucide-react';

// Round initial of an admin; without an email it stands for a server script
export function AdminAvatar({ email }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[0.625rem] font-semibold uppercase text-primary-soft-foreground"
    >
      {email ? email[0] : <Terminal className="size-3" />}
    </span>
  );
}
