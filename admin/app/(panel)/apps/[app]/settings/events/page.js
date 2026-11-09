import { getApp, getTrackingPlan } from '@/lib/apps';
import { checkTrackingPlan, uploadTrackingPlan } from '../actions';
import { EventsPanel } from './events-panel';

export default async function EventsSettingsPage({ params }) {
  const { app: slug } = await params;
  const [{ app }, overview] = await Promise.all([getApp(slug), getTrackingPlan(slug)]);

  return (
    <EventsPanel
      overview={overview}
      actions={{
        check: checkTrackingPlan.bind(null, app.slug),
        upload: uploadTrackingPlan.bind(null, app.slug),
      }}
    />
  );
}