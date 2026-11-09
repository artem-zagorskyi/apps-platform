'use client';

import { DataTable } from '@/components/data/data-table';
import { EmptyRow } from '@/components/data/states';
import { FileCheckUpload } from '@/components/settings/shared/file-check-upload';
import { CardSection, SettingsCard, SettingsColumn } from '@/components/settings/shared/settings-card';
import { Time } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STORE = { google_play: 'Google Play', app_store: 'App Store' };

const count = (n) => n.toLocaleString('en-US');

const PRODUCT_COLUMNS = [
  { key: 'productId', header: 'Product ID', width: 'minmax(170px,1.3fr)' },
  { key: 'store', header: 'Store', width: '100px' },
  { key: 'kind', header: 'Kind', width: '100px' },
  { key: 'entitlements', header: 'Grants', width: 'minmax(120px,1fr)' },
  { key: 'withAccess', header: 'With access', width: '96px', align: 'right' },
];

const HISTORY_COLUMNS = [
  { key: 'version', header: 'Version', width: '64px', mono: true },
  { key: 'uploadedAt', header: 'Uploaded', width: '150px' },
  { key: 'uploadedBy', header: 'By', width: 'minmax(120px,0.8fr)' },
  { key: 'summary', header: 'Changes', width: 'minmax(180px,1.4fr)' },
  { key: 'current', header: '', width: '64px', align: 'right' },
];

/**
 * overview: { currentVersion,
 *             products: [{ store, productId, kind, entitlements, archivedAt, withAccess }],
 *             entitlements: [{ key, products, withAccess }],
 *             history: [{ version, uploadedAt, uploadedBy, products, summary }] }
 * actions: bound server actions { check(text), upload(text) }
 */
export function SubscriptionsPanel({ overview, actions }) {
  const { currentVersion, products, entitlements, history } = overview;

  const productRows = products.map((product) => {
    const archived = product.archivedAt !== null;
    return {
      id: `${product.store}:${product.productId}`,
      productId: (
        <span className={cn('flex items-center gap-2', archived && 'opacity-60')}>
          <span className="truncate font-mono text-xs font-medium">{product.productId}</span>
          {archived && (
            <Badge tone="outline" size="sm">
              archived
            </Badge>
          )}
        </span>
      ),
      store: <span className="text-xs">{STORE[product.store] ?? product.store}</span>,
      kind: <span className="text-xs text-muted-foreground">{product.kind}</span>,
      entitlements: (
        <span className="flex flex-wrap gap-1">
          {product.entitlements.map((key) => (
            <Badge key={key} tone="primary" size="sm" className="font-mono">
              {key}
            </Badge>
          ))}
        </span>
      ),
      withAccess: (
        <span className={cn(product.withAccess === 0 && 'text-muted-foreground')}>{count(product.withAccess)}</span>
      ),
    };
  });

  const historyRows = history.map((version) => ({
    id: version.version,
    version: <span className="font-semibold">v{version.version}</span>,
    uploadedAt: (
      <span className="text-xs">
        <Time value={version.uploadedAt} />
      </span>
    ),
    uploadedBy: <span className="text-xs">{version.uploadedBy ?? 'billing:catalog script'}</span>,
    summary: (
      <span className="text-xs text-muted-foreground" title={version.summary}>
        {version.summary}
      </span>
    ),
    current:
      currentVersion === version.version ? (
        <Badge tone="success" size="sm">
          current
        </Badge>
      ) : null,
  }));

  return (
    <SettingsColumn>
      <SettingsCard
        title={currentVersion ? `Catalog v${currentVersion}` : 'Catalog'}
        description="Products the app sells and the entitlements each one grants. Archived products sell no more, but people who bought them keep access."
      >
        <DataTable
          columns={PRODUCT_COLUMNS}
          rows={productRows}
          minWidth={620}
          empty={<EmptyRow>No products. The app sells nothing, and this tab is optional.</EmptyRow>}
        />
        {entitlements.length > 0 && (
          <div className="flex flex-col border-t border-border pb-1.5">
            <div className="px-4 pb-1 pt-3 text-xs font-semibold text-muted-foreground">Entitlements</div>
            {entitlements.map((entitlement) => (
              <div key={entitlement.key} className="flex items-baseline gap-3 px-4 py-1.5 text-[13px]">
                <span className="font-mono text-xs font-semibold">{entitlement.key}</span>
                <span className="text-xs text-muted-foreground">
                  {entitlement.products === 0
                    ? 'only archived products'
                    : `${entitlement.products} product${entitlement.products === 1 ? '' : 's'} on sale`}
                </span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {count(entitlement.withAccess)} with access
                </span>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="Upload a catalog"
        description="Replaces the whole catalog. Products missing from the file are archived, never deleted; the kind of a product cannot change."
      >
        <CardSection border={false} className="pt-0">
          <FileCheckUpload
            fileName="catalog.json"
            checkAction={actions.check}
            uploadAction={actions.upload}
            successMessage={(data) =>
              data.status === 'created' ? `Catalog v${data.version} uploaded` : 'Nothing uploaded: the catalog is the same'
            }
          />
        </CardSection>
      </SettingsCard>

      <SettingsCard title="Version history" description="Every upload that changed the catalog, the last 20.">
        <DataTable
          columns={HISTORY_COLUMNS}
          rows={historyRows}
          minWidth={560}
          empty={<EmptyRow>No versions yet. The next upload is recorded here.</EmptyRow>}
        />
      </SettingsCard>
    </SettingsColumn>
  );
}