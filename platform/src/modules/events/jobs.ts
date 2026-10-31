import type { JobDefinition } from '../../core/jobs.js';
import { deleteOldEventIds } from './maintenance.js';
import { ensureEventPartitions } from './partitions.js';

export const eventsJobs: JobDefinition[] = [
  {
    name: 'events-ensure-partitions',
    schedule: '15 3 * * *',
    handler: async () => {
      await ensureEventPartitions();
    },
  },
  {
    name: 'events-delete-old-ids',
    schedule: '30 3 * * *',
    handler: async (_data, log) => {
      const deleted = await deleteOldEventIds(new Date());
      if (deleted > 0) log.info({ deleted }, 'old event ids deleted');
    },
  },
];