'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Segmented } from '@/components/ui/segmented';

const OPTIONS = [
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
  ['system', 'System', Monitor],
];

export function ThemeToggle({ collapsed }) {
  const { theme, setTheme } = useTheme();
  // The stored choice is known only in the browser: highlight nothing until
  // then, so the server render and the first browser render match
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const options = OPTIONS.map(([value, label, Icon]) => ({
    value,
    title: `${label} theme`,
    label: collapsed ? null : label,
    icon: <Icon className={collapsed ? 'size-3.5' : 'mr-1 inline size-3.5 align-[-2px]'} aria-hidden />,
  }));

  return (
    <Segmented
      options={options}
      value={mounted ? theme : ''}
      onValueChange={setTheme}
      fill
      className={collapsed ? 'flex-col' : undefined}
    />
  );
}