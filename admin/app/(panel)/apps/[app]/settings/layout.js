import { SectionPlaceholder } from '@/components/section-placeholder';
import { SettingsTabs } from '@/components/settings-tabs';
import { ALL_APPS } from '@/lib/nav';

export default async function SettingsLayout({ children, params }) {
  const { app } = await params;

  if (app === ALL_APPS) {
    return <SectionPlaceholder title="App settings" note="Settings belong to one app. Choose an app in the sidebar." />;
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <h1 className="text-2xl font-semibold">App settings</h1>
      <SettingsTabs app={app} />
      {children}
    </div>
  );
}