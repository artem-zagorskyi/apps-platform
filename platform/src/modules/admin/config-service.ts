import { db } from '../../core/db.js';
import { storeParameterSchema } from '../config/schemas-service.js';
import { forgetActiveConfig, getHoldout, storeHoldout } from '../config/versions-service.js';
import type { AdminApp } from './apps-service.js';
import { type Actor, writeAudit } from './audit.js';

// uploadedBy: the admin's email, shown in the version history
export async function uploadParameterSchema(actor: Actor, uploadedBy: string, app: AdminApp, json: unknown) {
  return db.transaction(async (tx) => {
    const upload = await storeParameterSchema(tx, app.id, json, uploadedBy);
    if (upload.status === 'created') {
      await writeAudit(
        {
          adminId: actor.adminId,
          action: 'parameter_schema.upload',
          appId: app.id,
          targetType: 'parameter_schema',
          targetId: app.id,
          details: { version: upload.version, parameters: upload.parameters, summary: upload.summary },
          ip: actor.ip,
        },
        tx,
      );
    }
    return upload;
  });
}

// Publishes a new config version with only the holdout changed
export async function setHoldout(actor: Actor, publishedBy: string, app: AdminApp, percent: number) {
  const before = await getHoldout(app.id);
  const result = await db.transaction(async (tx) => {
    const publish = await storeHoldout(tx, app.id, percent, { comment: `Holdout set to ${percent}%`, publishedBy });
    if (publish.status === 'created') {
      await writeAudit(
        {
          adminId: actor.adminId,
          action: 'config.set_holdout',
          appId: app.id,
          targetType: 'config',
          targetId: app.id,
          before: { percent: before.percent },
          after: { percent },
          details: { version: publish.version },
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