import Link from 'next/link';
import { SettingsCard } from '@/components/settings/shared/settings-card';
import { SETTINGS_TABS } from '@/lib/nav';
import { STATUS_TEXT, StatusDot } from './shared/tab-status';

// On General while something needed before release is missing or broken
export function SetupChecklist({ slug, tabs }) {
  const items = SETTINGS_TABS.filter(({ tab }) => tab !== 'general' && tabs[tab]).map(({ tab, label }) => ({
    tab,
    label,
    state: tabs[tab],
  }));
  const left = items.filter(({ state }) => state.status === 'not_configured' || state.status === 'error').length;
  if (left === 0) return null;

  return (
    <SettingsCard
      title="Setup checklist"
      description={`${left} step${left === 1 ? '' : 's'} left before release. Optional steps depend on what the app needs.`}
    >
      <ul className="flex flex-col border-t border-border">
        {items.map(({ tab, label, state }) => (
          <li key={tab} className="border-b border-border last:border-b-0">
            <Link
              href={`/apps/${encodeURIComponent(slug)}/settings/${tab}`}
              className="flex items-center gap-3 px-4 py-2.5 text-[0.8125rem] hover:bg-muted"
            >
              <StatusDot status={state.status} />
              <span className="w-28 shrink-0 font-medium">{label}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{state.hint}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{STATUS_TEXT[state.status]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}