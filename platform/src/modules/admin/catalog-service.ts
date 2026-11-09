import { db } from '../../core/db.js';
import { storeCatalog } from '../billing/catalog.js';
import type { AdminApp } from './apps-service.js';
import { type Actor, writeAudit } from './audit.js';

// uploadedBy: the admin's email, shown in the version history
export async function uploadCatalog(actor: Actor, uploadedBy: string, app: AdminApp, json: unknown) {
  return db.transaction(async (tx) => {
    const upload = await storeCatalog(tx, app.id, json, uploadedBy);
    if (upload.status === 'created') {
      await writeAudit(
        {
          adminId: actor.adminId,
          action: 'catalog.upload',
          appId: app.id,
          targetType: 'catalog',
          targetId: app.id,
          details: {
            version: upload.version,
            summary: upload.summary,
            added: upload.added,
            updated: upload.updated,
            archived: upload.archived,
          },
          ip: actor.ip,
        },
        tx,
      );
    }
    return upload;
  });
}