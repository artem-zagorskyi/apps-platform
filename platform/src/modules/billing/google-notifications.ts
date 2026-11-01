import { eq, lt } from 'drizzle-orm';
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { z } from 'zod';
import { config } from '../../core/config.js';
import { db } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { sendJob } from '../../core/jobs.js';
import { findAppByBundleId } from '../apps/service.js';
import { purchases, storeNotifications } from './schema.js';
import { syncPurchase } from './sync.js';

export const PROCESS_NOTIFICATION_JOB = 'billing-process-notification';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const NOTIFICATION_KEEP_MS = 90 * 24 * 60 * 60 * 1000;

// Google's keys for the OIDC tokens Pub/Sub attaches to pushes; a local key in tests
let googleKeys: JWTVerifyGetKey = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export function setPubSubKeysForTests(keys: JWTVerifyGetKey): void {
  googleKeys = keys;
}

// A push really comes from our Pub/Sub subscription: a Google-signed token
// for our audience, issued to the subscription's service account
export async function verifyPubSubPush(authorization: string | undefined): Promise<void> {
  const audience = config.GOOGLE_PUBSUB_AUDIENCE;
  const sender = config.GOOGLE_PUBSUB_SERVICE_ACCOUNT;
  if (!audience || !sender) throw new AppError(503, 'not_configured', 'Play notifications are not configured');

  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
  if (!token) throw new AppError(401, 'unauthorized', 'Missing push token', 'no_bearer_token');

  try {
    const { payload } = await jwtVerify(token, googleKeys, {
      issuer: GOOGLE_ISSUERS,
      audience,
      algorithms: ['RS256'],
      clockTolerance: '30s',
    });
    if (payload.email !== sender || payload.email_verified !== true) throw new Error('wrong_sender');
  } catch (err) {
    const reason = (err as { code?: string }).code ?? (err as Error).message;
    throw new AppError(401, 'unauthorized', 'Invalid push token', reason);
  }
}

export const pushBodySchema = z.object({
  message: z.object({
    data: z.string().optional(),
    messageId: z.string().min(1),
    publishTime: z.string().optional(),
  }),
  subscription: z.string().optional(),
});

// Stores a push once and queues it; undecodable messages are stored as
// processed with an error, so Pub/Sub stops redelivering them
export async function receivePlayNotification(body: z.infer<typeof pushBodySchema>): Promise<void> {
  let payload: unknown = null;
  try {
    payload = JSON.parse(Buffer.from(body.message.data ?? '', 'base64').toString('utf8'));
  } catch {
    payload = null;
  }
  const packageName = z.object({ packageName: z.string() }).safeParse(payload);

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(storeNotifications)
      .values({
        store: 'google_play',
        messageId: body.message.messageId,
        packageName: packageName.success ? packageName.data.packageName : null,
        payload: payload ?? { undecodable: body.message.data ?? null },
        ...(payload === null ? { processedAt: new Date(), outcome: 'ignored', error: 'undecodable' } : {}),
      })
      .onConflictDoNothing()
      .returning({ id: storeNotifications.id });

    // A redelivered message finds its row and queues nothing
    if (row && payload !== null) await sendJob(PROCESS_NOTIFICATION_JOB, { notificationId: row.id }, tx);
  });
}

const developerNotification = z.object({
  packageName: z.string(),
  subscriptionNotification: z
    .object({ notificationType: z.number(), purchaseToken: z.string(), subscriptionId: z.string() })
    .optional(),
  // productType 1: subscription, 2: one-time product
  voidedPurchaseNotification: z.object({ purchaseToken: z.string(), productType: z.number() }).optional(),
  testNotification: z.unknown().optional(),
});

// Whatever the notification says, the state comes from the store itself
export async function processPlayNotification(notificationId: string): Promise<string> {
  const [row] = await db.select().from(storeNotifications).where(eq(storeNotifications.id, notificationId));
  if (!row || row.processedAt) return 'skipped';

  const finish = async (outcome: string, error: string | null = null) => {
    await db
      .update(storeNotifications)
      .set({ processedAt: new Date(), outcome, error })
      .where(eq(storeNotifications.id, notificationId));
    return outcome;
  };

  const parsed = developerNotification.safeParse(row.payload);
  if (!parsed.success) return finish('ignored', 'unexpected_payload');
  const notification = parsed.data;

  const appId = await findAppByBundleId('android', notification.packageName);
  if (!appId) return finish('ignored', 'unknown_package');

  try {
    if (notification.subscriptionNotification) {
      const s = notification.subscriptionNotification;
      return finish(
        await syncPurchase({
          appId,
          store: 'google_play',
          packageName: notification.packageName,
          productId: s.subscriptionId,
          purchaseKey: s.purchaseToken,
          source: 'notification',
        }),
      );
    }

    if (notification.voidedPurchaseNotification) {
      const v = notification.voidedPurchaseNotification;
      if (v.productType !== 1) return finish('ignored', 'not_a_subscription');

      const [known] = await db
        .select({ productId: purchases.productId })
        .from(purchases)
        .where(eq(purchases.purchaseKey, v.purchaseToken));
      if (!known) return finish('unknown');

      return finish(
        await syncPurchase({
          appId,
          store: 'google_play',
          packageName: notification.packageName,
          productId: known.productId,
          purchaseKey: v.purchaseToken,
          source: 'notification',
          refunded: true,
        }),
      );
    }
  } catch (err) {
    // Kept unprocessed: the job retries
    await db
      .update(storeNotifications)
      .set({ error: err instanceof Error ? err.message : String(err) })
      .where(eq(storeNotifications.id, notificationId));
    throw err;
  }

  // Test notifications from the Play Console, one-time products
  return finish('ignored');
}

export async function deleteOldNotifications(now: Date): Promise<number> {
  const result = await db
    .delete(storeNotifications)
    .where(lt(storeNotifications.receivedAt, new Date(now.getTime() - NOTIFICATION_KEEP_MS)));
  return result.rowCount ?? 0;
}