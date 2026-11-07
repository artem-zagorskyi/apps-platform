import { redirect } from 'next/navigation';
import { appSectionHref } from '@/lib/nav';

export default async function AppIndexPage({ params }) {
  const { app } = await params;
  redirect(appSectionHref(app, 'overview'));
}