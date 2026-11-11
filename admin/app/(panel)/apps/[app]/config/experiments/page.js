import { getApp, getConfigOverview } from '@/lib/apps';
import { requireSession } from '@/lib/session';
import { discardConfigDraft, rebaseConfigDraft, saveConfigDraft } from '../actions';
import { ExperimentsView } from './experiments-view';

const EDITORS = ['owner', 'product'];

export default async function ConfigExperimentsPage({ params }) {
  const { app: slug } = await params;
  const [session, { app }, overview] = await Promise.all([requireSession(), getApp(slug), getConfigOverview(slug)]);
  const canEdit = session.roles.some((grant) => EDITORS.includes(grant.role) && (grant.appId === null || grant.appId === app.id));

  return (
    <ExperimentsView
      overview={overview}
      canEdit={canEdit}
      reviewHref={`/apps/${encodeURIComponent(app.slug)}/config/parameters?review=1`}
      actions={{
        save: saveConfigDraft.bind(null, app.slug),
        discard: discardConfigDraft.bind(null, app.slug),
        rebase: rebaseConfigDraft.bind(null, app.slug),
      }}
    />
  );
}
