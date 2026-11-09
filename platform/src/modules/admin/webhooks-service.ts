import { db } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { removeEndpoint, rotateEndpointSecret, setEndpointUrl } from '../webhooks/service.js';
import type { AdminApp } from './apps-service.js';
import { type Actor, writeAudit } from './audit.js';

// Secrets never reach the audit log: only the fact that one was issued

export async function setWebhookUrl(actor: Actor, app: AdminApp, url: string) {
  return db.transaction(async (tx) => {
    const result = await setEndpointUrl(tx, app.id, url);

    if (result.previousUrl !== result.url) {
      await writeAudit(
        {
          adminId: actor.adminId,
          action: result.previousUrl ? 'webhook.update_url' : 'webhook.create',
          appId: app.id,
          targetType: 'webhook',
          targetId: app.id,
          before: result.previousUrl ? { url: result.previousUrl } : undefined,
          after: { url: result.url },
          details: result.requeued > 0 ? { requeued: result.requeued } : undefined,
          ip: actor.ip,
        },
        tx,
      );
    }
    return { secret: result.secret, requeued: result.requeued };
  });
}

export async function rotateWebhookSecret(actor: Actor, app: AdminApp) {
  return db.transaction(async (tx) => {
    const secret = await rotateEndpointSecret(tx, app.id);
    await writeAudit(
      {
        adminId: actor.adminId,
        action: 'webhook.rotate_secret',
        appId: app.id,
        targetType: 'webhook',
        targetId: app.id,
        ip: actor.ip,
      },
      tx,
    );
    return secret;
  });
}

export async function removeWebhook(actor: Actor, app: AdminApp, reason: string) {
  await db.transaction(async (tx) => {
    const url = await removeEndpoint(app.id, tx);
    if (url === null) {
      throw new AppError(404, 'no_endpoint', 'The app has no webhook URL');
    }
    await writeAudit(
      {
        adminId: actor.adminId,
        action: 'webhook.remove',
        appId: app.id,
        targetType: 'webhook',
        targetId: app.id,
        reason,
        before: { url },
        ip: actor.ip,
      },
      tx,
    );
  });
}