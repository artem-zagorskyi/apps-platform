import { z } from 'zod';
import type { JobDefinition } from '../../core/jobs.js';
import { DELIVER_JOB, deleteOldDeliveries, deliverWebhook } from './service.js';

const deliverData = z.object({ deliveryId: z.uuid() });

export const webhooksJobs: JobDefinition[] = [
  {
    name: DELIVER_JOB,
    // 30 s, 1 min, 2 min ... up to 6 h between attempts: about three days in total
    retryLimit: 20,
    retryDelaySeconds: 30,
    retryDelayMaxSeconds: 6 * 60 * 60,
    expireInSeconds: 60,
    handler: async (data, log) => {
      const { deliveryId } = deliverData.parse(data);
      const outcome = await deliverWebhook(deliveryId);
      log.info({ deliveryId, outcome }, 'webhook delivery');
    },
  },
  {
    name: 'webhooks-delete-old-deliveries',
    schedule: '50 3 * * *',
    handler: async (_data, log) => {
      const deleted = await deleteOldDeliveries(new Date());
      if (deleted > 0) log.info({ deleted }, 'old webhook deliveries deleted');
    },
  },
];