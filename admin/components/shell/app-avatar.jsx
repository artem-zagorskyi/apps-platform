import { appColor, appInitials } from '@/lib/app-look';

// Coloured initials of an app; without an app it stands for "All apps"
export function AppAvatar({ app, size = 20 }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.42, background: app ? appColor(app) : 'oklch(0.45 0.02 260)' }}
      className="flex shrink-0 items-center justify-center rounded-[5px] font-mono font-semibold leading-none text-white"
    >
      {app ? appInitials(app.name) : 'All'}
    </span>
  );
}