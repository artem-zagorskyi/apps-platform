import {
  Activity,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';

// Stands for every app in URLs: /apps/all/overview
export const ALL_APPS = 'all';

// Section map of the panel. App sections live under /apps/<slug>/<section>;
// allApps marks the ones that also work as a summary over every app.
export const APP_SECTION_GROUPS = [
  {
    label: 'Analytics',
    items: [
      { section: 'overview', label: 'Overview', icon: LayoutDashboard, allApps: true },
      { section: 'audience', label: 'Audience', icon: Users, allApps: true },
      { section: 'consents', label: 'Consents', icon: ShieldCheck, allApps: true },
      { section: 'events', label: 'Events', icon: Activity, allApps: false },
    ],
  },
  {
    label: 'Product',
    items: [
      { section: 'config', label: 'Config & experiments', icon: SlidersHorizontal, allApps: false },
      { section: 'revenue', label: 'Subscriptions & revenue', icon: CreditCard, allApps: true },
    ],
  },
  {
    label: 'Operations',
    items: [
      { section: 'support', label: 'Support', icon: LifeBuoy, allApps: false },
      { section: 'settings', label: 'App settings', icon: Settings, allApps: false },
    ],
  },
];

// Shared by every app, outside /apps
export const PLATFORM_ITEMS = [
  { href: '/system', label: 'System', icon: Server },
  { href: '/admins', label: 'Admins & audit log', icon: KeyRound },
];

export function findSection(section) {
  return APP_SECTION_GROUPS.flatMap((group) => group.items).find((item) => item.section === section) ?? null;
}

export function appSectionHref(app, section) {
  return `/apps/${app}/${section}`;
}