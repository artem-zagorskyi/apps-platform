'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Reloads the server data every minute while the tab is visible
export function AutoRefresh({ everyMs = 60_000 }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
