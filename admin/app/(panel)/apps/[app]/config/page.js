import { redirect } from 'next/navigation';

export default async function ConfigPage({ params }) {
  const { app } = await params;
  redirect(`/apps/${encodeURIComponent(app)}/config/parameters`);
}
