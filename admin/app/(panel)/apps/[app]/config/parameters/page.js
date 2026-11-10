import { getApp, getConfigOverview } from '@/lib/apps';
import { requireSession } from '@/lib/session';
import { discardConfigDraft, publishConfigDraft, rebaseConfigDraft, saveConfigDraft } from '../actions';
import { ParametersWorkspace } from './parameters-workspace';

const EDITORS = ['owner', 'product'];

export default async function ConfigParametersPage({ params, searchParams }) {
  const { app: slug } = await params;
  const { review } = await searchParams;
  const [session, { app }, overview] = await Promise.all([requireSession(), getApp(slug), getConfigOverview(slug)]);
  const canEdit = session.roles.some((grant) => EDITORS.includes(grant.role) && (grant.appId === null || grant.appId === app.id));

  return (
    <ParametersWorkspace
      overview={overview}
      canEdit={canEdit}
      initialReview={review === '1'}
      actions={{
        save: saveConfigDraft.bind(null, app.slug),
        discard: discardConfigDraft.bind(null, app.slug),
        rebase: rebaseConfigDraft.bind(null, app.slug),
        publish: publishConfigDraft.bind(null, app.slug),
      }}
    />
  );
}
