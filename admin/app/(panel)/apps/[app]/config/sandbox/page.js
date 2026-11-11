import { getApp, getConfigOverview } from '@/lib/apps';
import { explainConfigForUser } from '../actions';
import { SandboxView } from './sandbox-view';

export default async function ConfigSandboxPage({ params }) {
  const { app: slug } = await params;
  const [{ app }, overview] = await Promise.all([getApp(slug), getConfigOverview(slug)]);

  return <SandboxView overview={overview} explain={explainConfigForUser.bind(null, app.slug)} />;
}
