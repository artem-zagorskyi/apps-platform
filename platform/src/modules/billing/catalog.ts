import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Tx } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { GRANTING_STATES } from './entitlements.js';
import { catalogVersions, productKindEnum, products, purchases, storeEnum } from './schema.js';

// The catalog file: what the app sells and which entitlements each product grants

const entitlementKey = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, 'must be snake_case');

// Google: lowercase, digits, _ and .; Apple also allows uppercase and -
const storeProductId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, 'not a store product id');

export const catalogFormat = z.strictObject({
  format_version: z.literal(1),
  products: z.array(
    z.strictObject({
      store: z.enum(storeEnum.enumValues),
      product_id: storeProductId,
      kind: z.enum(productKindEnum.enumValues),
      entitlements: z.array(entitlementKey).min(1),
    }),
  ),
});

export type Catalog = z.infer<typeof catalogFormat>;
type CatalogProduct = Catalog['products'][number];
type ProductRow = typeof products.$inferSelect;
type Executor = typeof db | Tx;

export type CatalogUploadResult = { added: number; updated: number; archived: number; unchanged: number };

// target: "store:product_id" or a path inside the file
export interface CatalogProblem {
  target: string;
  message: string;
}

export interface CatalogChange {
  kind: 'added' | 'changed' | 'archived';
  target: string;
  detail?: string;
}

export interface CatalogCheck {
  // ok: can be uploaded; unchanged: nothing would change; invalid: see errors
  status: 'ok' | 'unchanged' | 'invalid';
  currentVersion: number | null;
  nextVersion: number | null;
  products: number | null;
  errors: CatalogProblem[];
  // Purchases with access that would lose an entitlement
  warnings: CatalogProblem[];
  changes: CatalogChange[];
  summary: string | null;
}

export interface CatalogUpload extends CatalogUploadResult {
  status: 'created' | 'unchanged';
  // null when nothing changed and no version was recorded yet
  version: number | null;
  summary: string | null;
}

// Versions shown in the admin panel
const HISTORY_LIMIT = 20;

const keyOf = (store: string, productId: string) => `${store}:${productId}`;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Sorted products with sorted, unique entitlements: equal catalogs look equal
function normalize(catalog: Catalog): Catalog {
  return {
    format_version: 1,
    products: catalog.products
      .map((item) => ({ ...item, entitlements: [...new Set(item.entitlements)].sort() }))
      .sort((a, b) => keyOf(a.store, a.product_id).localeCompare(keyOf(b.store, b.product_id))),
  };
}

// Purchases that grant access right now, per product (same rule as grantsAccess)
async function purchasesWithAccess(appId: string, now: Date, executor: Executor = db): Promise<Map<string, number>> {
  const rows = await executor
    .select({
      store: purchases.store,
      productId: purchases.productId,
      count: sql<number>`count(*) filter (where ${purchases.state} = 'grace_period'
        or ${purchases.expiresAt} is null or ${purchases.expiresAt} > ${now.toISOString()})`.mapWith(Number),
    })
    .from(purchases)
    .where(and(eq(purchases.appId, appId), inArray(purchases.state, GRANTING_STATES)))
    .groupBy(purchases.store, purchases.productId);
  return new Map(rows.map((row) => [keyOf(row.store, row.productId), row.count]));
}

async function latestVersion(appId: string, executor: Executor = db): Promise<number | null> {
  const [row] = await executor
    .select({ number: catalogVersions.number })
    .from(catalogVersions)
    .where(eq(catalogVersions.appId, appId))
    .orderBy(desc(catalogVersions.number))
    .limit(1);
  return row?.number ?? null;
}

interface CatalogPlan {
  catalog: Catalog | null;
  invalid: CatalogProblem[];
  // A product's kind cannot change: its purchases are handled by it
  breaking: CatalogProblem[];
  warnings: CatalogProblem[];
  changes: CatalogChange[];
  counts: CatalogUploadResult;
  inserts: CatalogProduct[];
  updates: { id: string; item: CatalogProduct }[];
  archives: string[];
}

// What replacing the app's products with this file would do
function planCatalog(existing: ProductRow[], withAccess: Map<string, number>, json: unknown): CatalogPlan {
  const plan: CatalogPlan = {
    catalog: null,
    invalid: [],
    breaking: [],
    warnings: [],
    changes: [],
    counts: { added: 0, updated: 0, archived: 0, unchanged: 0 },
    inserts: [],
    updates: [],
    archives: [],
  };

  const parsed = catalogFormat.safeParse(json);
  if (!parsed.success) {
    plan.invalid = parsed.error.issues.map((issue) => ({
      target: issue.path.map(String).join('.') || 'catalog',
      message: issue.message,
    }));
    return plan;
  }

  const seen = new Set<string>();
  for (const item of parsed.data.products) {
    const key = keyOf(item.store, item.product_id);
    if (seen.has(key)) plan.invalid.push({ target: key, message: 'listed twice' });
    seen.add(key);
  }
  if (plan.invalid.length > 0) return plan;

  const catalog = normalize(parsed.data);
  plan.catalog = catalog;
  const byKey = new Map(existing.map((product) => [keyOf(product.store, product.productId), product]));

  for (const item of catalog.products) {
    const key = keyOf(item.store, item.product_id);
    const current = byKey.get(key);

    if (!current) {
      plan.inserts.push(item);
      plan.counts.added++;
      plan.changes.push({ kind: 'added', target: key, detail: `${item.kind} · ${item.entitlements.join(', ')}` });
      continue;
    }
    if (current.kind !== item.kind) {
      plan.breaking.push({ target: key, message: `kind cannot change from ${current.kind} to ${item.kind}` });
      continue;
    }

    const sameEntitlements = current.entitlements.join(',') === item.entitlements.join(',');
    if (current.archivedAt === null && sameEntitlements) {
      plan.counts.unchanged++;
      continue;
    }

    plan.updates.push({ id: current.id, item });
    plan.counts.updated++;
    if (current.archivedAt !== null) plan.changes.push({ kind: 'changed', target: key, detail: 'back from the archive' });
    if (!sameEntitlements) {
      plan.changes.push({
        kind: 'changed',
        target: key,
        detail: `entitlements: ${current.entitlements.join(', ')} → ${item.entitlements.join(', ')}`,
      });
      const lost = current.entitlements.filter((entitlement) => !item.entitlements.includes(entitlement));
      const affected = withAccess.get(key) ?? 0;
      if (lost.length > 0 && affected > 0) {
        plan.warnings.push({
          target: key,
          message: `${plural(affected, 'purchase', 'purchases')} with access ${affected === 1 ? 'loses' : 'lose'} ${lost.join(', ')} at once; the app backend is not notified`,
        });
      }
    }
  }

  // Archived products keep granting their entitlements to existing purchases
  for (const product of existing) {
    const key = keyOf(product.store, product.productId);
    if (product.archivedAt === null && !seen.has(key)) {
      plan.archives.push(product.id);
      plan.counts.archived++;
      plan.changes.push({ kind: 'archived', target: key, detail: 'no new purchases; existing ones keep access' });
    }
  }

  return plan;
}

function summarize(counts: CatalogUploadResult, firstCatalog: boolean, products: number): string {
  if (firstCatalog) return `First catalog · ${plural(products, 'product', 'products')}`;
  const parts = [
    counts.added > 0 && plural(counts.added, 'product added', 'products added'),
    counts.updated > 0 && `${counts.updated} updated`,
    counts.archived > 0 && `${counts.archived} archived`,
  ].filter(Boolean);
  return parts.join(' · ');
}

function listProblems(problems: CatalogProblem[]): string {
  return problems.map((problem) => `${problem.target}: ${problem.message}`).join('\n');
}

const changesNothing = (counts: CatalogUploadResult) => counts.added + counts.updated + counts.archived === 0;

// What uploading this file would do. Nothing is stored.
export async function checkCatalog(appId: string, json: unknown, now = new Date()): Promise<CatalogCheck> {
  const [existing, withAccess, current] = await Promise.all([
    db.select().from(products).where(eq(products.appId, appId)),
    purchasesWithAccess(appId, now),
    latestVersion(appId),
  ]);
  const plan = planCatalog(existing, withAccess, json);
  const errors = [...plan.invalid, ...plan.breaking];
  const unchanged = plan.catalog !== null && changesNothing(plan.counts);
  const status = errors.length > 0 ? 'invalid' : unchanged ? 'unchanged' : 'ok';
  const count = plan.catalog?.products.length ?? null;

  return {
    status,
    currentVersion: current,
    nextVersion: status === 'ok' ? (current ?? 0) + 1 : null,
    products: count,
    errors,
    warnings: plan.warnings,
    changes: plan.changes,
    summary: count !== null && !unchanged ? summarize(plan.counts, existing.length === 0, count) : null,
  };
}

// Replaces the app's catalog in the caller's transaction: new products are
// added, changed ones updated, missing ones archived (purchases of archived
// products keep their entitlements). Records a version when something changed.
export async function storeCatalog(
  tx: Tx,
  appId: string,
  json: unknown,
  uploadedBy: string | null = null,
  now = new Date(),
): Promise<CatalogUpload> {
  // One upload per app at a time, so version numbers stay sequential
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`catalog:${appId}`}, 0))`);

  const existing = await tx.select().from(products).where(eq(products.appId, appId));
  const plan = planCatalog(existing, await purchasesWithAccess(appId, now, tx), json);
  if (!plan.catalog || plan.invalid.length > 0) {
    throw new AppError(400, 'invalid_catalog', `Invalid catalog:\n${listProblems(plan.invalid)}`);
  }
  if (plan.breaking.length > 0) {
    throw new AppError(409, 'incompatible_catalog', listProblems(plan.breaking));
  }

  const current = await latestVersion(appId, tx);
  if (changesNothing(plan.counts)) {
    return { status: 'unchanged', version: current, summary: null, ...plan.counts };
  }

  for (const item of plan.inserts) {
    await tx.insert(products).values({
      appId,
      store: item.store,
      productId: item.product_id,
      kind: item.kind,
      entitlements: item.entitlements,
    });
  }
  for (const { id, item } of plan.updates) {
    await tx
      .update(products)
      .set({ entitlements: item.entitlements, archivedAt: null, updatedAt: now })
      .where(eq(products.id, id));
  }
  if (plan.archives.length > 0) {
    await tx.update(products).set({ archivedAt: now, updatedAt: now }).where(inArray(products.id, plan.archives));
  }

  const version = (current ?? 0) + 1;
  const summary = summarize(plan.counts, existing.length === 0, plan.catalog.products.length);
  await tx.insert(catalogVersions).values({ appId, number: version, catalog: plan.catalog, summary, uploadedBy });
  return { status: 'created', version, summary, ...plan.counts };
}

// Replaces the app's catalog (the billing:catalog script)
export async function uploadCatalog(
  appId: string,
  json: unknown,
  now = new Date(),
  uploadedBy: string | null = null,
): Promise<CatalogUploadResult> {
  const result = await db.transaction((tx) => storeCatalog(tx, appId, json, uploadedBy, now));
  return { added: result.added, updated: result.updated, archived: result.archived, unchanged: result.unchanged };
}

// Products with their purchases that grant access, the entitlements and the latest versions
export async function getCatalogOverview(appId: string, now = new Date()) {
  const [rows, withAccess, versions] = await Promise.all([
    db.select().from(products).where(eq(products.appId, appId)),
    purchasesWithAccess(appId, now),
    db
      .select({
        number: catalogVersions.number,
        summary: catalogVersions.summary,
        uploadedBy: catalogVersions.uploadedBy,
        createdAt: catalogVersions.createdAt,
        catalog: catalogVersions.catalog,
      })
      .from(catalogVersions)
      .where(eq(catalogVersions.appId, appId))
      .orderBy(desc(catalogVersions.number))
      .limit(HISTORY_LIMIT),
  ]);

  const list = rows
    .map((product) => ({
      store: product.store,
      productId: product.productId,
      kind: product.kind,
      entitlements: product.entitlements,
      archivedAt: product.archivedAt,
      withAccess: withAccess.get(keyOf(product.store, product.productId)) ?? 0,
    }))
    // Products in the catalog first, archived ones after
    .sort(
      (a, b) =>
        Number(a.archivedAt !== null) - Number(b.archivedAt !== null) ||
        keyOf(a.store, a.productId).localeCompare(keyOf(b.store, b.productId)),
    );

  const entitlements = new Map<string, { key: string; products: number; withAccess: number }>();
  for (const product of list) {
    for (const key of product.entitlements) {
      const entry = entitlements.get(key) ?? { key, products: 0, withAccess: 0 };
      if (product.archivedAt === null) entry.products++;
      entry.withAccess += product.withAccess;
      entitlements.set(key, entry);
    }
  }

  return {
    currentVersion: versions[0]?.number ?? null,
    products: list,
    entitlements: [...entitlements.values()].sort((a, b) => a.key.localeCompare(b.key)),
    history: versions.map((version) => ({
      version: version.number,
      uploadedAt: version.createdAt,
      uploadedBy: version.uploadedBy,
      products: version.catalog.products.length,
      summary: version.summary,
    })),
  };
}