import { compareConfigVersions, getApp, getConfigOverview, getConfigVersions } from '@/lib/apps';
import { requireSession } from '@/lib/session';
import { discardConfigDraft, rebaseConfigDraft, restoreConfigVersion } from '../actions';
import { VersionsView } from './versions-view';

const EDITORS = ['owner', 'product'];

export default async function ConfigVersionsPage({ params, searchParams }) {
  const { app: slug } = await params;
  const query = await searchParams;
  const [session, { app }, overview, { versions }] = await Promise.all([
    requireSession(),
    getApp(slug),
    getConfigOverview(slug),
    getConfigVersions(slug),
  ]);
  const canEdit = session.roles.some((grant) => EDITORS.includes(grant.role) && (grant.appId === null || grant.appId === app.id));

  // A and B: by default the version before the live one, and the live one
  const known = new Set(versions.map((version) => version.version));
  const pick = (value, fallback) => (known.has(Number(value)) ? Number(value) : fallback);
  const b = pick(query.b, versions[0]?.version ?? null);
  const a = pick(query.a, versions[1]?.version ?? null);
  const comparison = a !== null && b !== null && a !== b ? await compareConfigVersions(slug, a, b) : null;

  return (
    <VersionsView
      versions={versions}
      draft={overview.draft}
      liveVersion={overview.live?.version ?? null}
      a={a}
      b={b}
      comparison={comparison}
      canEdit={canEdit}
      reviewHref={`/apps/${encodeURIComponent(app.slug)}/config/parameters?review=1`}
      actions={{
        discard: discardConfigDraft.bind(null, app.slug),
        rebase: rebaseConfigDraft.bind(null, app.slug),
        restore: restoreConfigVersion.bind(null, app.slug),
      }}
    />
  );
}
