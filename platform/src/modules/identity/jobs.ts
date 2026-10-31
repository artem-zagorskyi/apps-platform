import type { JobDefinition } from '../../core/jobs.js';
import { deleteOldNonces, deleteOldSessions } from './maintenance.js';

export const identityJobs: JobDefinition[] = [
  {
    name: 'identity-delete-old-nonces',
    schedule: '5 * * * *',
    handler: async (_data, log) => {
      const deleted = await deleteOldNonces(new Date());
      if (deleted > 0) log.info({ deleted }, 'old nonces deleted');
    },
  },
  {
    name: 'identity-delete-old-sessions',
    schedule: '45 3 * * *',
    handler: async (_data, log) => {
      const deleted = await deleteOldSessions(new Date());
      if (deleted > 0) log.info({ deleted }, 'old sessions deleted');
    },
  },
];