import 'server-only';
import { cache } from 'react';
import { adminApi } from './admin-api';

// Apps the signed-in admin may see, once per request
export const getVisibleApps = cache(async () => (await adminApi('/apps')).apps);