import { getApp, getConfigSchema } from '@/lib/apps';
import { checkParameterSchema, setHoldout, uploadParameterSchema } from '../actions';
import { ConfigPanel } from './config-panel';

export default async function ConfigSettingsPage({ params }) {
  const { app: slug } = await params;
  const [{ app }, overview] = await Promise.all([getApp(slug), getConfigSchema(slug)]);

  return (
    <ConfigPanel
      overview={overview}
      configHref={`/apps/${encodeURIComponent(app.slug)}/config`}
      actions={{
        check: checkParameterSchema.bind(null, app.slug),
        upload: uploadParameterSchema.bind(null, app.slug),
        setHoldout: setHoldout.bind(null, app.slug),
      }}
    />
  );
}