import { ActionForm } from '@/components/action-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getApp } from '@/lib/apps';
import { setPlatform } from '../actions';

const PLATFORMS = [
  { platform: 'android', label: 'Android', field: 'Package name' },
  { platform: 'ios', label: 'iOS', field: 'Bundle ID' },
];

export default async function PlatformsSettingsPage({ params }) {
  const { app: slug } = await params;
  const { app, platforms } = await getApp(slug);

  return (
    <div className="grid gap-8">
      <p className="text-sm text-muted-foreground">
        Store purchases and notifications are matched to the app by these ids. Set them before release: an app in
        the store keeps its id for good.
      </p>
      {PLATFORMS.map(({ platform, label, field }) => {
        const current = platforms.find((entry) => entry.platform === platform);
        return (
          <section key={platform} className="grid gap-3">
            <h2 className="text-lg font-medium">{label}</h2>
            <ActionForm action={setPlatform.bind(null, app.slug, platform)} submitLabel={current ? 'Save' : 'Add'}>
              <Label htmlFor={`${platform}-id`}>{field}</Label>
              <Input
                id={`${platform}-id`}
                name="bundleId"
                defaultValue={current?.bundleId}
                placeholder="com.example.app"
                className="font-mono"
                required
                maxLength={155}
              />
            </ActionForm>
          </section>
        );
      })}
    </div>
  );
}