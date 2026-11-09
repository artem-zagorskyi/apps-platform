'use client';

import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Check, LogOut, UserRound } from 'lucide-react';
import { signOut } from '@/app/(panel)/actions';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { THEME_OPTIONS } from './theme-toggle';

// The collapsed sidebar's whole footer: one avatar that opens account, theme and sign out
export function AccountMenu({ email }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  return (
    <Menu>
      <MenuTrigger
        title={`${email}: account and theme`}
        className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-foreground outline-none hover:ring-2 hover:ring-sidebar-border focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {email[0].toUpperCase()}
      </MenuTrigger>
      <MenuContent side="right" align="end" sideOffset={10} className="w-[13.75rem]">
        <div className="truncate px-2 pb-1.5 pt-1 text-xs text-muted-foreground" title={email}>
          {email}
        </div>
        <MenuItem onClick={() => router.push('/account')}>
          <UserRound />
          My account
        </MenuItem>
        <MenuSeparator />
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <MenuItem key={value} onClick={() => setTheme(value)}>
            <Icon />
            {label}
            {theme === value && <Check className="ml-auto !size-3.5 text-primary" />}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onClick={() => signOut()}>
          <LogOut />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}