import { sql } from 'drizzle-orm';
import { db } from '../../core/db.js';

// Replaces the user, installation and session ids of these users' events
// with new random ids: one new user id for all of them (one person), one new
// id per original installation and session. The mapping is never stored.
// Counts, funnels and sessions keep their shape; the events can no longer
// be linked to the person. Repeatable: anonymized rows no longer match.
export async function anonymizeUserEvents(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  // A Postgres array literal; the ids come from our own database
  const ids = `{${userIds.join(',')}}`;

  const result = await db.execute(sql`
    with new_user as (
      select gen_random_uuid() as id
    ),
    installation_map as (
      select installation_id, gen_random_uuid() as new_id
      from (
        select distinct installation_id from events.events
        where user_id = any(${ids}::uuid[])
      ) i
    ),
    session_map as (
      select session_id, gen_random_uuid() as new_id
      from (
        select distinct session_id from events.events
        where user_id = any(${ids}::uuid[]) and session_id is not null
      ) s
    )
    update events.events e
    set
      user_id = (select id from new_user),
      installation_id = (select new_id from installation_map m where m.installation_id = e.installation_id),
      session_id = (select new_id from session_map m where m.session_id = e.session_id)
    where e.user_id = any(${ids}::uuid[])
  `);
  return result.rowCount ?? 0;
}