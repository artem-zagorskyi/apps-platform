import { getApp, getConfigOverview, getOverview, getTrackingPlan } from '@/lib/apps';
import { requireSession } from '@/lib/session';
import { discardConfigDraft, rebaseConfigDraft, saveConfigDraft } from '../actions';
import { ExperimentsView } from './experiments-view';

const EDITORS = ['owner', 'product'];

// Events an experiment can be judged by: the app's plan and the platform events
function eventsOf(trackingPlan) {
  const all = [trackingPlan?.current?.plan, trackingPlan?.platform].flatMap((plan) => Object.entries(plan?.events ?? {}));
  const names = new Map();
  for (const [name, event] of all) if (!event.deprecated) names.set(name, { name, category: event.category });
  return [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export default async function ConfigExperimentsPage({ params }) {
  const { app: slug } = await params;
  const [session, { app }, overview, trackingPlan, apps] = await Promise.all([
    requireSession(),
    getApp(slug),
    getConfigOverview(slug),
    getTrackingPlan(slug),
    // Only for the traffic estimate: the page works without it
    getOverview().catch(() => []),
  ]);
  const canEdit = session.roles.some((grant) => EDITORS.includes(grant.role) && (grant.appId === null || grant.appId === app.id));
  const dailyUsers = apps.find((item) => item.slug === app.slug)?.metrics?.dau?.value ?? null;

  return (
    <ExperimentsView
      overview={overview}
      canEdit={canEdit}
      events={eventsOf(trackingPlan)}
      dailyUsers={dailyUsers}
      reviewHref={`/apps/${encodeURIComponent(app.slug)}/config/parameters?review=1`}
      actions={{
        save: saveConfigDraft.bind(null, app.slug),
        discard: discardConfigDraft.bind(null, app.slug),
        rebase: rebaseConfigDraft.bind(null, app.slug),
      }}
    />
  );
}
