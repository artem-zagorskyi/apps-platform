import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { productKindEnum, products, storeEnum } from './schema.js';

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

export type CatalogUploadResult = { added: number; updated: number; archived: number; unchanged: number };

const keyOf = (store: string, productId: string) => `${store}:${productId}`;

// Replaces the app's catalog: new products are added, changed ones updated,
// missing ones archived (purchases of archived products keep their entitlements)
export async function uploadCatalog(appId: string, json: unknown, now = new Date()): Promise<CatalogUploadResult> {
  const parsed = catalogFormat.safeParse(json);
  if (!parsed.success) {
    throw new AppError(400, 'invalid_catalog', `Invalid catalog: ${parsed.error.message}`);
  }

  const seen = new Set<string>();
  for (const item of parsed.data.products) {
    const key = keyOf(item.store, item.product_id);
    if (seen.has(key)) throw new AppError(400, 'invalid_catalog', `Invalid catalog: ${key} is listed twice`);
    seen.add(key);
  }

  return db.transaction(async (tx): Promise<CatalogUploadResult> => {
    const existing = await tx.select().from(products).where(eq(products.appId, appId));
    const byKey = new Map(existing.map((p) => [keyOf(p.store, p.productId), p]));
    const result: CatalogUploadResult = { added: 0, updated: 0, archived: 0, unchanged: 0 };

    for (const item of parsed.data.products) {
      const entitlements = [...new Set(item.entitlements)].sort();
      const current = byKey.get(keyOf(item.store, item.product_id));

      if (!current) {
        await tx.insert(products).values({
          appId,
          store: item.store,
          productId: item.product_id,
          kind: item.kind,
          entitlements,
        });
        result.added++;
        continue;
      }

      // A purchase is handled by its product's kind: it cannot change later
      if (current.kind !== item.kind) {
        throw new AppError(
          409,
          'incompatible_catalog',
          `${keyOf(item.store, item.product_id)}: kind cannot change from ${current.kind} to ${item.kind}`,
        );
      }

      if (current.archivedAt === null && current.entitlements.join(',') === entitlements.join(',')) {
        result.unchanged++;
        continue;
      }

      await tx
        .update(products)
        .set({ entitlements, archivedAt: null, updatedAt: now })
        .where(eq(products.id, current.id));
      result.updated++;
    }

    for (const product of existing) {
      if (product.archivedAt === null && !seen.has(keyOf(product.store, product.productId))) {
        await tx.update(products).set({ archivedAt: now, updatedAt: now }).where(eq(products.id, product.id));
        result.archived++;
      }
    }

    return result;
  });
}