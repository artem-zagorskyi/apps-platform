import { redirect } from 'next/navigation';

export default async function SettingsIndexPage({ params }) {
  const { app } = await params;
  redirect(`/apps/${app}/settings/general`);
}