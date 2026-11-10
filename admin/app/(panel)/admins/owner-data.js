import 'server-only';
import { redirect } from 'next/navigation';
import { AdminApiError, adminApi } from '@/lib/admin-api';

// Reads admin API paths open to owners of every app only.
// null: the signed-in admin is not one of them.
export async function loadOwnerData(paths) {
  try {
    return await Promise.all(paths.map((path) => adminApi(path)));
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) redirect('/login');
    if (err instanceof AdminApiError && err.status === 403) return null;
    throw err;
  }
}
