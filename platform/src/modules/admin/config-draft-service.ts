import { db } from '../../core/db.js';
import { diffDocuments } from '../config/diff.js';
import { deleteDraft, discardDraft, restoreVersionAsDraft, takeDraftForPublish } from '../config/drafts-service.js';
import { lockAppConfig } from '../config/lock.js';
import { forgetActiveConfig, storeConfigVersion } from '../config/versions-service.js';
import type { AdminApp } from './apps-service.js';
import { type Actor, writeAudit } from './audit.js';

// Publishes the draft as the next version and removes it. A draft that does
// not pass the checks stays as it is.
export async function publishDraft(actor: Actor, publishedBy: string, app: AdminApp, comment: string) {
  const result = await db.transaction(async (tx) => {
    // Before reading: no other publish slips in between
    await lockAppConfig(tx, app.id);
    const { draft, live } = await takeDraftForPublish(tx, app.id);
    const changes = diffDocuments(live?.document ?? null, draft.document);

    const publish = await storeConfigVersion(tx, app.id, draft.document, { comment, publishedBy });
    await deleteDraft(tx, app.id);
    if (publish.status === 'created') {
      await writeAudit(
        {
          adminId: actor.adminId,
          action: 'config.publish',
          appId: app.id,
          targetType: 'config',
          targetId: String(publish.version),
          reason: comment,
          details: { version: publish.version, changes: changes.length },
          ip: actor.ip,
        },
        tx,
      );
    }
    return publish;
  });

  if (result.status === 'created') forgetActiveConfig(app.id);
  return result;
}

export async function discardConfigDraft(actor: Actor, app: AdminApp) {
  if (await discardDraft(app.id)) {
    await writeAudit({ adminId: actor.adminId, action: 'config.draft_discard', appId: app.id, targetType: 'config', targetId: app.id, ip: actor.ip });
  }
}

export async function restoreConfigVersion(actor: Actor, updatedBy: string, app: AdminApp, version: number, replace: boolean) {
  const result = await restoreVersionAsDraft(app.id, version, { updatedBy, replace });
  await writeAudit({
    adminId: actor.adminId,
    action: 'config.restore',
    appId: app.id,
    targetType: 'config',
    targetId: String(version),
    details: { version },
    ip: actor.ip,
  });
  return result;
}
