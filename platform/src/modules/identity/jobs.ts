import { z } from 'zod';
import type { JobDefinition } from '../../core/jobs.js';
import { deleteOldConsents, ERASE_JOB, eraseOverdueUsers, eraseUser } from './deletion.js';
import { deleteOldNonces, deleteOldSessions } from './maintenance.js';

const eraseData = z.object({ userId: z.uuid() });

export const identityJobs: JobDefinition[] = [
  {
    name: ERASE_JOB,
    retryLimit: 10,
    retryDelaySeconds: 60,
    retryDelayMaxSeconds: 60 * 60,
    // Anonymizing events of a long history may take a while
    expireInSeconds: 30 * 60,
    handler: async (data, log) => {
      const { userId } = eraseData.parse(data);
      const outcome = await eraseUser(userId, new Date());
      log.info({ userId, outcome }, 'user erase');
    },
  },
  {
    name: 'identity-erase-overdue',
    schedule: '20 4 * * *',
    handler: async (_data, log) => {
      const erased = await eraseOverdueUsers(new Date());
      if (erased > 0) log.warn({ erased }, 'overdue users erased');
    },
  },
  {
    name: 'identity-delete-old-consents',
    schedule: '40 4 * * *',
    handler: async (_data, log) => {
      const deleted = await deleteOldConsents(new Date());
      if (deleted > 0) log.info({ deleted }, 'consents of long deleted users removed');
    },
  },
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