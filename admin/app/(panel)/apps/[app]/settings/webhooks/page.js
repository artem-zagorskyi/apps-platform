import { getApp, getWebhookSettings } from '@/lib/apps';
import { removeWebhookUrl, rotateWebhookSecret, sendTestWebhook, setWebhookUrl } from '../actions';
import { WebhooksPanel } from './webhooks-panel';

export default async function WebhooksSettingsPage({ params }) {
  const { app: slug } = await params;
  const [{ app }, overview] = await Promise.all([getApp(slug), getWebhookSettings(slug)]);

  return (
    <WebhooksPanel
      overview={overview}
      actions={{
        setUrl: setWebhookUrl.bind(null, app.slug),
        rotateSecret: rotateWebhookSecret.bind(null, app.slug),
        sendTest: sendTestWebhook.bind(null, app.slug),
        removeUrl: removeWebhookUrl.bind(null, app.slug),
      }}
    />
  );
}