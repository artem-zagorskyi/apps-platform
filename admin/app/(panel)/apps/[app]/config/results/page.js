import { getApp, getConfigOverview, getExperimentResults, getOverview } from '@/lib/apps';
import { trafficShare } from '@/lib/config-format';
import { ResultsView } from './results-view';

export default async function ConfigResultsPage({ params, searchParams }) {
  const { app: slug } = await params;
  const query = await searchParams;
  const [{ app }, overview, apps] = await Promise.all([
    getApp(slug),
    getConfigOverview(slug),
    // Only for the consent share: the page works without it
    getOverview().catch(() => []),
  ]);

  // Started experiments, running ones first, newest first
  const experiments = Object.entries(overview.live?.document.experiments ?? {})
    .filter(([, experiment]) => experiment.started_at)
    .sort(
      ([, a], [, b]) =>
        Number(b.status === 'running') - Number(a.status === 'running') || new Date(b.started_at) - new Date(a.started_at),
    )
    .map(([key, experiment]) => ({ key, status: experiment.status, layer: experiment.layer, share: trafficShare(experiment) }));

  const key = experiments.some((item) => item.key === query.experiment) ? query.experiment : (experiments[0]?.key ?? null);
  let results = null;
  let error = null;
  if (key) {
    try {
      results = await getExperimentResults(app.slug, key);
    } catch (err) {
      error = err.message ?? 'Results could not be loaded';
    }
  }

  return (
    <ResultsView
      experiments={experiments}
      experimentKey={key}
      results={results}
      error={error}
      consentRate={apps.find((item) => item.slug === app.slug)?.metrics?.consentRate?.value ?? null}
    />
  );
}
