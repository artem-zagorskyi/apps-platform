'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Segmented } from '@/components/ui/segmented';

export const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // The stored choice is known only in the browser: highlight nothing until
  // then, so the server render and the first browser render match
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const options = THEME_OPTIONS.map(({ value, label, icon: Icon }) => ({
    value,
    label,
    title: `${label} theme`,
    icon: <Icon className="mr-1 inline size-3.5 align-[-0.125rem]" aria-hidden />,
  }));

  return <Segmented options={options} value={mounted ? theme : ''} onValueChange={setTheme} fill />;
}