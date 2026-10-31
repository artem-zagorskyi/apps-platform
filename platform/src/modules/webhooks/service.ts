import { createHmac, randomBytes } from 'node:crypto';
import { eq, lt, sql } from 'drizzle-orm';
import { config } from '../../core/config.js';
import { decryptSecret, encryptSecret } from '../../core/crypto.js';
import { db, type Tx } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { sendJob } from '../../core/jobs.js';
import { deliveries, endpoints } from './schema.js';

export const DELIVER_JOB = 'webhooks-deliver';

export type WebhookType = 'user.merged' | 'user.deleted';

export type DeliveryOutcome = 'delivered' | 'already_delivered' | 'no_endpoint' | 'missing';

const SEND_TIMEOUT_MS = 10_000;
const DELIVERY_KEEP_MS = 90 * 24 * 60 * 60 * 1000;

// Sets the endpoint of an app and returns a new signing secret.
// The secret is shown once; the backend keeps it to verify signatures.
export async function setEndpoint(appId: string, url: string): Promise<string> {
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

  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  const secretEncrypted = encryptSecret(secret);
  await db
    .insert(endpoints)
    .values({ appId, url: parsed.toString(), secretEncrypted })
    .onConflictDoUpdate({
      target: endpoints.appId,
      set: { url: parsed.toString(), secretEncrypted, updatedAt: new Date() },
    });
  return secret;
}

export async function removeEndpoint(appId: string): Promise<void> {
  await db.delete(endpoints).where(eq(endpoints.appId, appId));
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

// One delivery attempt. Throws on failure, so the job queue retries it.
export async function deliverWebhook(deliveryId: string): Promise<DeliveryOutcome> {
  const [delivery] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
  if (!delivery) return 'missing';
  if (delivery.deliveredAt) return 'already_delivered';

  const [endpoint] = await db.select().from(endpoints).where(eq(endpoints.appId, delivery.appId));
  if (!endpoint) {
    // No backend yet: nothing to retry
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
  const signature = signWebhook(decryptSecret(endpoint.secretEncrypted), Math.floor(Date.now() / 1000), body);

  let status: number | null = null;
  let error: string | null = null;
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'apps-platform-webhooks',
        'x-platform-delivery': delivery.id,
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

// Delivery history is kept for 90 days
export async function deleteOldDeliveries(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - DELIVERY_KEEP_MS);
  const result = await db.delete(deliveries).where(lt(deliveries.createdAt, cutoff));
  return result.rowCount ?? 0;
}