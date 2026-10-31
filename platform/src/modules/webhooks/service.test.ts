import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedApp } from '../../../test/helpers.js';
import { queuedJobs } from '../../../test/jobs.js';
import { decryptSecret } from '../../core/crypto.js';
import { db, pool } from '../../core/db.js';
import { deliveries, endpoints } from './schema.js';
import {
  DELIVER_JOB,
  deleteOldDeliveries,
  deliverWebhook,
  notifyApp,
  setEndpoint,
  signWebhook,
} from './service.js';

const received: { headers: IncomingHttpHeaders; body: string }[] = [];
let responseStatus = 200;

// A fake app backend
const receiver = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on('end', () => {
    received.push({ headers: req.headers, body });
    res.statusCode = responseStatus;
    res.end();
  });
});
let receiverUrl: string;
let appId: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hooks`;
});

beforeEach(async () => {
  await resetDatabase();
  appId = await seedApp();
  received.length = 0;
  queuedJobs.length = 0;
  responseStatus = 200;
});

afterAll(async () => {
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
  await pool.end();
});

// Records a notification the way a module does and returns its delivery id
async function notify(data: Record<string, unknown> = { userId: 'u-1' }): Promise<string> {
  await db.transaction((tx) => notifyApp(tx, appId, 'user.merged', data));
  const job = queuedJobs.at(-1);
  expect(job?.name).toBe(DELIVER_JOB);
  return job?.data.deliveryId as string;
}

describe('setEndpoint', () => {
  it('stores the URL and only an encrypted secret', async () => {
    const secret = await setEndpoint(appId, receiverUrl);

    const [row] = await db.select().from(endpoints).where(eq(endpoints.appId, appId));
    expect(secret).toMatch(/^whsec_/);
    expect(row?.url).toBe(receiverUrl);
    expect(row?.secretEncrypted).not.toContain(secret);
    expect(decryptSecret(row!.secretEncrypted)).toBe(secret);
  });

  it('rejects anything but http and https', async () => {
    await expect(setEndpoint(appId, 'ftp://example.com')).rejects.toMatchObject({
      code: 'invalid_webhook_url',
    });
    await expect(setEndpoint(appId, 'not a url')).rejects.toMatchObject({ code: 'invalid_webhook_url' });
  });
});

describe('deliverWebhook', () => {
  it('posts a signed notification once', async () => {
    const secret = await setEndpoint(appId, receiverUrl);
    const deliveryId = await notify({ userId: 'u-1' });

    expect(await deliverWebhook(deliveryId)).toBe('delivered');
    expect(await deliverWebhook(deliveryId)).toBe('already_delivered');

    expect(received).toHaveLength(1);
    const { headers, body } = received[0]!;
    expect(JSON.parse(body)).toMatchObject({ id: deliveryId, type: 'user.merged', appId, data: { userId: 'u-1' } });
    expect(headers['x-platform-delivery']).toBe(deliveryId);

    // The backend's check: same HMAC over "<t>.<body>"
    const signature = headers['x-platform-signature'] as string;
    const timestamp = Number(/t=(\d+)/.exec(signature)?.[1]);
    expect(signature).toBe(signWebhook(secret, timestamp, body));
  });

  it('records a failed attempt and throws, so the queue retries', async () => {
    await setEndpoint(appId, receiverUrl);
    const deliveryId = await notify();
    responseStatus = 500;

    await expect(deliverWebhook(deliveryId)).rejects.toThrow('HTTP 500');
    const [failed] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
    expect(failed).toMatchObject({ attempts: 1, lastStatus: 500, lastError: 'HTTP 500', deliveredAt: null });

    responseStatus = 200;
    expect(await deliverWebhook(deliveryId)).toBe('delivered');
    const [delivered] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
    expect(delivered?.attempts).toBe(2);
    expect(delivered?.deliveredAt).not.toBeNull();
  });

  it('gives up quietly when the app has no backend', async () => {
    const deliveryId = await notify();

    expect(await deliverWebhook(deliveryId)).toBe('no_endpoint');
    expect(received).toHaveLength(0);
  });

  it('records nothing when the transaction rolls back', async () => {
    await expect(
      db.transaction(async (tx) => {
        await notifyApp(tx, appId, 'user.merged', {});
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');

    expect(await db.select().from(deliveries).where(eq(deliveries.appId, appId))).toEqual([]);
  });
});

describe('deleteOldDeliveries', () => {
  it('deletes deliveries older than 90 days', async () => {
    const deliveryId = await notify();
    await db
      .update(deliveries)
      .set({ createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) })
      .where(eq(deliveries.id, deliveryId));

    expect(await deleteOldDeliveries(new Date())).toBe(1);
  });
});