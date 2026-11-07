import { notFound } from 'next/navigation';
import { SETTINGS_TABS } from '@/lib/nav';

// Tabs without a page of their own yet
export default async function SettingsTabPage({ params }) {
  const { tab } = await params;
  const item = SETTINGS_TABS.find((entry) => entry.tab === tab);

  if (!item) {
    notFound();
  }

  return <p className="text-muted-foreground">{item.label}: not built yet.</p>;
}