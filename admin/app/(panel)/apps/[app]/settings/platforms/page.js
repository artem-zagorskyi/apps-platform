import { ActionForm } from '@/components/action-form';
import { StatusBadge } from '@/components/data/status-badge';
import { Time } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
    <div className="flex flex-col gap-4">
      <p className="text-[0.8125rem] text-muted-foreground text-pretty">
        Store purchases and notifications are matched to the app by these ids. Set them before the first release: an app
        in the store keeps its id for good.
      </p>
      {PLATFORMS.map(({ platform, label, field }) => {
        const current = platforms.find((entry) => entry.platform === platform);
        return (
          <Card key={platform}>
            <CardHeader
              title={label}
              description={
                current ? (
                  <>
                    {field} · added <Time value={current.createdAt} />
                  </>
                ) : (
                  `${field} · not added yet`
                )
              }
              actions={
                current ? <StatusBadge status="active" label="added" /> : <Badge tone="outline">not added</Badge>
              }
            />
            <CardBody>
              <ActionForm
                action={setPlatform.bind(null, app.slug, platform)}
                submitLabel={current ? 'Save' : 'Add'}
                successMessage={current ? `${field} saved` : `${label} added`}
                inline
              >
                <Input
                  name="bundleId"
                  aria-label={field}
                  defaultValue={current?.bundleId}
                  placeholder="com.example.app"
                  mono
                  required
                  maxLength={155}
                />
              </ActionForm>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}