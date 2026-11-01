import { z } from 'zod';
import type { JobDefinition } from '../../core/jobs.js';
import { deleteOldNotifications, PROCESS_NOTIFICATION_JOB, processPlayNotification } from './google-notifications.js';
import { reconcileVoided, refreshOverdue } from './sync.js';

const notificationData = z.object({ notificationId: z.uuid() });

export const billingJobs: JobDefinition[] = [
  {
    name: PROCESS_NOTIFICATION_JOB,
    retryLimit: 20,
    retryDelaySeconds: 60,
    retryDelayMaxSeconds: 60 * 60,
    handler: async (data, log) => {
      const { notificationId } = notificationData.parse(data);
      const outcome = await processPlayNotification(notificationId);
      log.info({ notificationId, outcome }, 'store notification');
    },
  },
  {
    name: 'billing-reconcile-voided',
    schedule: '10 5 * * *',
    handler: async (_data, log) => {
      const refunded = await reconcileVoided(new Date());
      if (refunded > 0) log.info({ refunded }, 'refunds reconciled');
    },
  },
  {
    name: 'billing-refresh-overdue',
    schedule: '25 * * * *',
    handler: async (_data, log) => {
      const refreshed = await refreshOverdue(new Date());
      if (refreshed > 0) log.warn({ refreshed }, 'purchases refreshed after a missed notification');
    },
  },
  {
    name: 'billing-delete-old-notifications',
    schedule: '55 3 * * *',
    handler: async (_data, log) => {
      const deleted = await deleteOldNotifications(new Date());
      if (deleted > 0) log.info({ deleted }, 'old store notifications deleted');
    },
  },
];