import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { config } from '../../core/config.js';
import { decryptSecret, encryptSecret } from '../../core/crypto.js';
import { db, type Tx } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { sendJob } from '../../core/jobs.js';
import { deliveries, endpoints } from './schema.js';

export const DELIVER_JOB = 'webhooks-deliver';

export type WebhookType = 'user.merged' | 'user.deleted' | 'entitlements.changed';

export type DeliveryOutcome = 'delivered' | 'already_delivered' | 'no_endpoint' | 'missing';

// State of a delivery as the admin panel shows it
export type DeliveryStatus = 'delivered' | 'no_endpoint' | 'pending' | 'failed';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEND_TIMEOUT_MS = 10_000;
const DELIVERY_KEEP_MS = 90 * DAY_MS;
// Notifications that found no URL are sent once one is set, if this recent
const REQUEUE_WINDOW_MS = 7 * DAY_MS;
const REQUEUE_LIMIT = 1000;
// Window of the delivery statistics in the admin panel
const STATS_WINDOW_MS = 7 * DAY_MS;

// The URL an app backend receives notifications at, normalized
function checkUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(400, 'invalid_webhook_url', `Not a URL: ${url}`);
  }
  // Plain http only for local development
  const allowed = config.NODE_ENV === 'production' ? ['https:'] : ['https:', 'http:'];
  if (!allowed.includes(parsed.protocol)) {
    throw new AppError(400, 'invalid_webhook_url', `The URL must use ${allowed.join(' or ')}`);
  }
  return parsed.toString();
}

function newSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

// Sets the endpoint of an app with a new signing secret and returns the secret
// (the webhooks:set script). The secret is shown once; the backend keeps it.
export async function setEndpoint(appId: string, url: string): Promise<string> {
  const target = checkUrl(url);
  const secret = newSecret();
  const secretEncrypted = encryptSecret(secret);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .insert(endpoints)
      .values({ appId, url: target, secretEncrypted, secretRotatedAt: now })
      .onConflictDoUpdate({
        target: endpoints.appId,
        set: { url: target, secretEncrypted, secretRotatedAt: now, updatedAt: now },
      });
    await requeueWaiting(tx, appId, now);
  });
  return secret;
}

// Sets or changes the URL. A new endpoint gets a signing secret, returned once;
// an existing one keeps its secret, so the app backend needs no change.
export async function setEndpointUrl(tx: Tx, appId: string, url: string, now: Date = new Date()) {
  const target = checkUrl(url);
  const [existing] = await tx
    .select({ url: endpoints.url })
    .from(endpoints)
    .where(eq(endpoints.appId, appId))
    .for('update');

  if (existing) {
    if (existing.url !== target) {
      await tx.update(endpoints).set({ url: target, updatedAt: now }).where(eq(endpoints.appId, appId));
    }
    return { url: target, previousUrl: existing.url, secret: null, requeued: 0 };
  }

  const secret = newSecret();
  await tx.insert(endpoints).values({ appId, url: target, secretEncrypted: encryptSecret(secret), secretRotatedAt: now });
  const requeued = await requeueWaiting(tx, appId, now);
  return { url: target, previousUrl: null, secret, requeued };
}

// A new signing secret, returned once. The old one stops working at once.
export async function rotateEndpointSecret(tx: Tx, appId: string, now: Date = new Date()): Promise<string> {
  const secret = newSecret();
  const updated = await tx
    .update(endpoints)
    .set({ secretEncrypted: encryptSecret(secret), secretRotatedAt: now, updatedAt: now })
    .where(eq(endpoints.appId, appId))
    .returning({ appId: endpoints.appId });
  if (updated.length === 0) {
    throw new AppError(404, 'no_endpoint', 'The app has no webhook URL');
  }
  return secret;
}

// Removes the endpoint; returns its URL, or null if there was none
export async function removeEndpoint(appId: string, executor: typeof db | Tx = db): Promise<string | null> {
  const [removed] = await executor
    .delete(endpoints)
    .where(eq(endpoints.appId, appId))
    .returning({ url: endpoints.url });
  return removed?.url ?? null;
}

// Notifications that found no URL are queued again, if they are recent enough
async function requeueWaiting(tx: Tx, appId: string, now: Date): Promise<number> {
  const waiting = await tx
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.appId, appId),
        isNull(deliveries.deliveredAt),
        eq(deliveries.lastError, 'no_endpoint'),
        gt(deliveries.createdAt, new Date(now.getTime() - REQUEUE_WINDOW_MS)),
      ),
    )
    .orderBy(deliveries.createdAt)
    .limit(REQUEUE_LIMIT);

  for (const { id } of waiting) {
    await sendJob(DELIVER_JOB, { deliveryId: id }, tx);
  }
  return waiting.length;
}

// Records a notification and queues its delivery in the caller's transaction:
// if the change is rolled back, nothing is sent
export async function notifyApp(
  tx: Tx,
  appId: string,
  type: WebhookType,
  data: Record<string, unknown>,
): Promise<void> {
  const [delivery] = await tx
    .insert(deliveries)
    .values({ appId, type, payload: data })
    .returning({ id: deliveries.id });
  if (!delivery) throw new Error('Failed to record a webhook delivery');
  await sendJob(DELIVER_JOB, { deliveryId: delivery.id }, tx);
}

// "t=<unix seconds>,v1=<hex HMAC-SHA256 of '<t>.<body>'>"
export function signWebhook(secret: string, timestamp: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

interface SendResult {
  status: number | null;
  error: string | null;
  ms: number;
}

// Signs and posts one notification. Never throws: the result says what happened.
async function postSigned(url: string, secret: string, id: string, body: string): Promise<SendResult> {
  const signature = signWebhook(secret, Math.floor(Date.now() / 1000), body);
  const started = performance.now();
  let status: number | null = null;
  let error: string | null = null;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'apps-platform-webhooks',
        'x-platform-delivery': id,
        'x-platform-signature': signature,
      },
      body,
      // A redirect could send user data elsewhere: treat it as a failure
      redirect: 'manual',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    status = response.status;
    await response.body?.cancel();
    if (status < 200 || status >= 300) error = `HTTP ${status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return { status, error, ms: Math.round(performance.now() - started) };
}

// One delivery attempt. Throws on failure, so the job queue retries it.
export async function deliverWebhook(deliveryId: string): Promise<DeliveryOutcome> {
  const [delivery] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
  if (!delivery) return 'missing';
  if (delivery.deliveredAt) return 'already_delivered';

  const [endpoint] = await db.select().from(endpoints).where(eq(endpoints.appId, delivery.appId));
  if (!endpoint) {
    // No backend yet: nothing to retry. Setting a URL later queues it again.
    await db.update(deliveries).set({ lastError: 'no_endpoint' }).where(eq(deliveries.id, deliveryId));
    return 'no_endpoint';
  }

  const body = JSON.stringify({
    id: delivery.id,
    type: delivery.type,
    appId: delivery.appId,
    createdAt: delivery.createdAt.toISOString(),
    data: delivery.payload,
  });
  const { status, error } = await postSigned(endpoint.url, decryptSecret(endpoint.secretEncrypted), delivery.id, body);

  await db
    .update(deliveries)
    .set({
      attempts: sql`${deliveries.attempts} + 1`,
      lastStatus: status,
      lastError: error,
      ...(error ? {} : { deliveredAt: new Date() }),
    })
    .where(eq(deliveries.id, deliveryId));

  if (error) throw new Error(`Webhook delivery failed: ${error}`);
  return 'delivered';
}

// A one-off "test" notification to check the backend. Not stored, not retried.
export async function sendTestWebhook(appId: string) {
  const [endpoint] = await db
    .select({ url: endpoints.url, secretEncrypted: endpoints.secretEncrypted })
    .from(endpoints)
    .where(eq(endpoints.appId, appId));
  if (!endpoint) {
    throw new AppError(404, 'no_endpoint', 'The app has no webhook URL');
  }

  const id = randomUUID();
  const body = JSON.stringify({ id, type: 'test', appId, createdAt: new Date().toISOString(), data: {} });
  const result = await postSigned(endpoint.url, decryptSecret(endpoint.secretEncrypted), id, body);
  return { ok: result.error === null, httpStatus: result.status, ms: result.ms, error: result.error };
}

function deliveryStatus(delivery: { deliveredAt: Date | null; lastError: string | null; attempts: number }): DeliveryStatus {
  if (delivery.deliveredAt) return 'delivered';
  if (delivery.lastError === 'no_endpoint') return 'no_endpoint';
  return delivery.attempts === 0 ? 'pending' : 'failed';
}

// The endpoint, delivery statistics of the last 7 days and the latest deliveries
export async function getWebhookOverview(appId: string, now: Date = new Date()) {
  const since = new Date(now.getTime() - STATS_WINDOW_MS);

  const [endpoint] = await db
    .select({ url: endpoints.url, createdAt: endpoints.createdAt, secretRotatedAt: endpoints.secretRotatedAt })
    .from(endpoints)
    .where(eq(endpoints.appId, appId));

  const [counts] = await db
    .select({
      delivered: sql<number>`count(*) filter (where ${deliveries.deliveredAt} is not null)`.mapWith(Number),
      notDelivered: sql<number>`count(*) filter (where ${deliveries.deliveredAt} is null and ${deliveries.attempts} > 0)`.mapWith(Number),
      waitingForUrl: sql<number>`count(*) filter (where ${deliveries.deliveredAt} is null and ${deliveries.lastError} = 'no_endpoint')`.mapWith(Number),
    })
    .from(deliveries)
    .where(and(eq(deliveries.appId, appId), gt(deliveries.createdAt, since)));

  const recent = await db
    .select({
      id: deliveries.id,
      type: deliveries.type,
      deliveredAt: deliveries.deliveredAt,
      attempts: deliveries.attempts,
      lastStatus: deliveries.lastStatus,
      lastError: deliveries.lastError,
      createdAt: deliveries.createdAt,
    })
    .from(deliveries)
    .where(eq(deliveries.appId, appId))
    .orderBy(desc(deliveries.createdAt))
    .limit(5);

  const delivered = counts?.delivered ?? 0;
  const notDelivered = counts?.notDelivered ?? 0;
  const attempted = delivered + notDelivered;

  return {
    endpoint: endpoint ?? null,
    stats: {
      delivered7d: delivered,
      notDelivered7d: notDelivered,
      successRate7d: attempted > 0 ? delivered / attempted : null,
      waitingForUrl: counts?.waitingForUrl ?? 0,
    },
    recent: recent.map((delivery) => ({ ...delivery, status: deliveryStatus(delivery) })),
  };
}

// Delivery history is kept for 90 days
export async function deleteOldDeliveries(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - DELIVERY_KEEP_MS);
  const result = await db.delete(deliveries).where(lt(deliveries.createdAt, cutoff));
  return result.rowCount ?? 0;
}