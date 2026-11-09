import { db } from '../../core/db.js';
import { forgetEffectivePlan, storeTrackingPlan } from '../events/plans-service.js';
import type { AdminApp } from './apps-service.js';
import { type Actor, writeAudit } from './audit.js';

// uploadedBy: the admin's email, shown in the version history
export async function uploadTrackingPlan(actor: Actor, uploadedBy: string, app: AdminApp, json: unknown) {
  const result = await db.transaction(async (tx) => {
    const upload = await storeTrackingPlan(tx, app.id, json, uploadedBy);
    if (upload.status === 'created') {
      await writeAudit(
        {
          adminId: actor.adminId,
          action: 'tracking_plan.upload',
          appId: app.id,
          targetType: 'tracking_plan',
          targetId: app.id,
          details: { version: upload.version, events: upload.events, summary: upload.summary },
          ip: actor.ip,
        },
        tx,
      );
    }
    return upload;
  });

  if (result.status === 'created') forgetEffectivePlan(app.id);
  return result;
}