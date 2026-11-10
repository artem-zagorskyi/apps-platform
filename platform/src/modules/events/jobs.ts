import type { JobDefinition } from '../../core/jobs.js';
import { deleteOldEventIds } from './maintenance.js';
import { ensureEventPartitions } from './partitions.js';
import { deleteOldPresence } from '../events/presence.js';

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
  {
    name: 'events-delete-old-presence',
    schedule: '55 4 * * *',
    handler: async (_data, log) => {
      const deleted = await deleteOldPresence(new Date());
      if (deleted > 0) log.info({ deleted }, 'old presence removed');
    },
  },
];