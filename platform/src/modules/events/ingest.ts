import { db } from '../../core/db.js';
import { countryOf } from '../../core/geoip.js';
import { isAnalyticsAllowed } from '../identity/consent.js';
import type { AccessTokenClaims } from '../identity/tokens.js';
import { events } from './events-table.js';
import { checkEvent } from './plan.js';
import { getEffectivePlan } from './plans-service.js';
import { eventIds } from './schema.js';

export interface IncomingEvent {
  eventId: string;
  name: string;
  occurredAt: Date; // device clock
  sessionId: string | null;
  seq: number;
  appVersion: string;
  appBuild: string;
  osVersion: string;
  properties: Record<string, unknown>;
}

export interface IngestResult {
  // Stored now or earlier (duplicates): the client drops them from its queue
  accepted: string[];
  // Not stored and never will be: the client drops them too
  rejected: { eventId: string; reason: string }[];
  // Stored but not matching the tracking plan
  invalid: number;
}

export async function ingestEvents(
  auth: AccessTokenClaims,
  batch: { sentAt: Date; events: IncomingEvent[] },
  ip: string,
): Promise<IngestResult> {
  const receivedAt = new Date();
  // Device clock error, applied to every event of the batch
  const clockSkew = receivedAt.getTime() - batch.sentAt.getTime();

  const plan = await getEffectivePlan(auth.appId);
  const analyticsAllowed = await isAnalyticsAllowed(auth.appId, auth.userId);
  const country = countryOf(ip);

  const rejected: IngestResult['rejected'] = [];
  const rows: (typeof events.$inferInsert)[] = [];
  const seen = new Set<string>();

  for (const event of batch.events) {
    // The same event twice in one batch is stored once
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);

    const check = checkEvent(plan, event.name, event.properties);
    // Unknown events are treated as analytics: the strictest assumption
    const category = check.category ?? 'analytics';

    if (category === 'analytics' && !analyticsAllowed) {
      rejected.push({ eventId: event.eventId, reason: 'no_consent' });
      continue;
    }

    rows.push({
      eventId: event.eventId,
      appId: auth.appId,
      userId: auth.userId,
      installationId: auth.installationId,
      sessionId: event.sessionId,
      seq: event.seq,
      name: event.name,
      category,
      occurredAt: new Date(Math.min(event.occurredAt.getTime() + clockSkew, receivedAt.getTime())),
      clientOccurredAt: event.occurredAt,
      receivedAt,
      platform: auth.platform,
      appVersion: event.appVersion,
      appBuild: event.appBuild,
      osVersion: event.osVersion,
      country,
      properties: event.properties,
      valid: check.ok,
      invalidReason: check.ok ? null : check.reason,
    });
  }

  if (rows.length > 0) {
    await db.transaction(async (tx) => {
      // Only ids not seen before come back; their events are new
      const fresh = await tx
        .insert(eventIds)
        .values(rows.map((row) => ({ eventId: row.eventId })))
        .onConflictDoNothing()
        .returning({ eventId: eventIds.eventId });

      const freshIds = new Set(fresh.map((row) => row.eventId));
      const newRows = rows.filter((row) => freshIds.has(row.eventId));
      if (newRows.length > 0) await tx.insert(events).values(newRows);
    });
  }

  return {
    accepted: rows.map((row) => row.eventId),
    rejected,
    invalid: rows.filter((row) => !row.valid).length,
  };
}