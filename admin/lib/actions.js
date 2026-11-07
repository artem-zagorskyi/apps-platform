import 'server-only';
import { AdminApiError } from './admin-api';

// Runs a change through the admin API for a form. Errors the admin can fix
// (4xx) come back as a message for the form; anything else is a real error.
export async function runAction(change) {
  try {
    await change();
    return { ok: true };
  } catch (err) {
    if (err instanceof AdminApiError && err.status < 500) {
      return { error: err.message };
    }
    throw err;
  }
}