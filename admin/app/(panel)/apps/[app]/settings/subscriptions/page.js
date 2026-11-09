import { getApp, getCatalog } from '@/lib/apps';
import { checkCatalog, uploadCatalog } from '../actions';
import { SubscriptionsPanel } from './subscriptions-panel';

export default async function SubscriptionsSettingsPage({ params }) {
  const { app: slug } = await params;
  const [{ app }, overview] = await Promise.all([getApp(slug), getCatalog(slug)]);

  return (
    <SubscriptionsPanel
      overview={overview}
      actions={{
        check: checkCatalog.bind(null, app.slug),
        upload: uploadCatalog.bind(null, app.slug),
      }}
    />
  );
}