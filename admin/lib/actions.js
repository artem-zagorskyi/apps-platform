import 'server-only';
import { AdminApiError } from './admin-api';

// Runs a change through the admin API for a form or a dialog. Errors the admin
// can fix (4xx) come back as a message; anything else is a real error.
// Whatever the change returns is passed on as `data`.
export async function runAction(change) {
  try {
    const data = await change();
    return data === undefined ? { ok: true } : { ok: true, data };
  } catch (err) {
    if (err instanceof AdminApiError && err.status < 500) {
      return { error: err.message };
    }
    throw err;
  }
}