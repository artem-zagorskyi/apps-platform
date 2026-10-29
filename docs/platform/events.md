# Events module

Event tracking from the app to the database: a tracking plan describes every
event, the SDK generates typed Dart code from it, queues events on the device
and sends them in batches; the server checks consent and the plan and stores
them in a monthly partitioned table.

```
tracking_plan.yaml ──generator──> events.g.dart (typed calls)
                                └> tracking_plan.json ──plan:upload──> events.tracking_plans

app code ─> AppEvents.lessonCompleted(...) ─> EventManager ─> SQLite queue
         ─> POST /v1/events (batches) ─> consent + plan check ─> events.events
```

SDK behaviour: [requirements.md](../sdk/requirements.md#events).
Commands: [commands.md](../commands.md#events).

## Tracking plan

A YAML file listing every event the app may send. Nothing outside the plan is
sent by the generated code; events that still do not match it are stored with
a flag (see [Validation](#validation)).

| File | Owner | Contains |
|------|-------|----------|
| `tracking-plan/platform.yaml` | This repository | Standard platform events recorded by the SDK |
| `tracking-plan/platform.json` | Generated | Read by the server at start-up (`PLATFORM_TRACKING_PLAN_PATH`) |
| `tracking_plan.yaml` in the app repository | The app | The app's own events |
| `tracking_plan.json` in the app repository | Generated | Uploaded to the server with `pnpm plan:upload` |

The server validates an app's events against the platform plan plus the
app's latest uploaded plan. App events must not reuse platform event names.

### Format

```yaml
events:
  lesson_completed:
    category: analytics          # essential | analytics
    description: The person finished a lesson
    properties:
      lesson_id:
        type: string
        max_length: 16
        description: Lesson id from the course catalog
      mistakes:
        type: integer
        min: 0
      level:
        type: enum
        values: [beginner, intermediate, advanced]
      used_hint:
        type: boolean
        required: false
```

Rules:

- Event, property and enum value names are `snake_case`, at most 64
  characters. Event names read as `object_action` in the past tense.
- `category`:
  - `essential`: needed to run the app or the business (purchases); recorded
    without analytics consent.
  - `analytics`: behaviour; recorded only with analytics consent, not even
    stored on the device without it.
- `description` is required for every event.
- Properties are flat. Types: `boolean`, `integer` and `number` (optional
  `min`, `max`), `string` (`max_length` from 1 to 128 and a `description`,
  both required), `enum` (`values`, non-empty).
- Properties are required unless `required: false`.
- Strings must say what they hold. No free text typed by the person.
- Unknown keys are errors, so typos do not slip through.

### Evolution

Installed app versions keep sending what their plan said, so a plan only grows:

| Allowed | Not allowed |
|---------|-------------|
| New events | Removing an event or a property: mark it `deprecated: true` |
| New optional properties | New required properties on an existing event |
| New enum values | Removing enum values |
| Making a property optional | Changing a property type or an event category |

The generator compares the new plan with the existing JSON before writing it,
and the server compares an uploaded plan with the latest stored one
(`409 incompatible_tracking_plan`). A deprecated required property is no
longer required on the server.

### Generated code

The generator is part of the SDK (`bin/events.dart`). It writes:

- a Dart class (default `AppEvents`) with one method per event, named
  parameters per property and an enum type per enum property, for example
  `events.demoActionTapped(action: DemoActionTappedAction.signOut)`;
- the normalized JSON with the same keys as the YAML.

The app creates the class once: `final events = AppEvents(platform.events);`.

## Standard platform events

Recorded by the SDK itself (`tracking-plan/platform.yaml`). All are
`analytics`.

| Event | Properties | When |
|-------|------------|------|
| `app_installed` | — | First launch of the installation |
| `app_updated` | `previous_version`, `previous_build` | App version or build changed since the previous launch |
| `app_opened` | `cold_start` | The app came to the foreground; `true` after a process start |
| `session_started` | — | A new session began |
| `session_ended` | `duration_seconds` | The previous session ended; recorded when the next one starts |
| `screen_viewed` | `screen` | The app called `platform.trackScreen('paywall')` |

Sessions:

- Coming back within 30 minutes in the background continues the session,
  also after the system stopped the process.
- `duration_seconds` counts foreground time only.
- After a crash (no background transition) the next launch starts a new session.
- Every event carries the current `session_id`.

Before analytics consent the SDK keeps only two facts: "install not
recorded" and "session start not recorded". It records `app_installed` and
`session_started` once consent is given, with the consent time. No behaviour
is stored before consent.

Account and consent changes are not events: the server already has them in
`identity.*` tables.

## `POST /v1/events`

Auth required. Rate limit 120/min per IP.

```json
{
  "sentAt": "device time of sending (ISO 8601)",
  "events": [
    {
      "eventId": "uuid v7, generated on the device",
      "name": "app_opened",
      "occurredAt": "device time of the event",
      "sessionId": "uuid or null",
      "seq": 42,
      "appVersion": "1.0.0",
      "appBuild": "1",
      "osVersion": "15",
      "properties": { "cold_start": true }
    }
  ]
}
```

- 1 to 100 events per batch, at most 50 properties per event.
- The category is not sent: the server takes it from the plan.
- `seq`: position in the installation's event stream (the SDK queue's
  auto-increment).

Response `200`:

```json
{
  "accepted": ["event ids stored now or earlier"],
  "rejected": [{ "eventId": "...", "reason": "no_consent" }]
}
```

The SDK removes both accepted and rejected events from its queue. Anything
missing from both stays queued and is sent again.

### Processing

1. **Clock correction.** `server now - sentAt` is the device clock error. It
   is added to every `occurredAt` of the batch; the result is never later
   than the receive time. The original device time is kept in
   `client_occurred_at`.
2. **Plan check.** The event is checked against the platform plan plus the
   app's latest plan (cached for one minute).
3. **Consent.** Analytics events need the user's latest analytics decision
   to be a grant, or the policy mode `none` when the person never decided.
   Otherwise they are rejected with `no_consent`. Unknown events count as
   analytics.
4. **Deduplication.** Event ids go to `events.event_ids` first; only ids not
   seen before are inserted into `events.events`, in the same transaction.
   A retried batch is accepted again without duplicates.
5. **Country.** From the request IP via the GeoIP database, if configured.
   The IP itself is never stored.

### Validation

Events that do not match the plan are **stored**, with `valid = false` and a
reason. Dropping them would lose data because of a plan mistake. The server
logs a warning with the count.

| Reason | Meaning |
|--------|---------|
| `unknown_event` | Not in the platform or the app plan |
| `unknown_property:<key>` | Property not in the plan |
| `missing_property:<key>` | Required property not sent |
| `not_boolean:<key>`, `not_integer:<key>`, `not_number:<key>`, `not_string:<key>` | Wrong type |
| `too_long:<key>` | String longer than `max_length` |
| `below_min:<key>`, `above_max:<key>` | Number out of range |
| `not_allowed_value:<key>` | Not one of the enum values |

## Storage

### `events.events`

Partitioned by month of the corrected `occurred_at` (UTC). Created by a
hand-written migration, because Drizzle cannot express partitioning; the
typed description for queries is in `events-table.ts`.

| Column | Meaning |
|--------|---------|
| `event_id` | From the device |
| `app_id`, `user_id`, `installation_id` | From the access token, never from the body |
| `session_id`, `seq` | From the device |
| `name`, `category` | Category from the plan |
| `occurred_at` | Corrected event time; the partition key |
| `client_occurred_at` | Device time as sent |
| `received_at` | Server time of the batch |
| `platform` | From the access token |
| `app_version`, `app_build`, `os_version` | At the time of the event |
| `country` | From GeoIP, or null |
| `properties` | `jsonb` |
| `valid`, `invalid_reason` | Plan check result |

No foreign keys on purpose: this table grows fastest, and ownership is
guaranteed by the access token.

Indexes (created on every partition automatically):

- `(app_id, name, occurred_at)`: charts and funnels
- `(user_id, occurred_at)`: one person's history

### Partitions

- One partition per month: `events.events_2026_10`, `events_2026_11`, ...
- `events.ensure_partitions(months_ahead)` creates the current month and the
  next ones; safe to call any number of times. The server calls it with 2 at
  start-up and every 12 hours.
- `events.events_default` catches events outside every partition (a device
  clock years off).
- Old months are dropped or anonymized as a whole partition, which is cheap
  compared to deleting rows.

### Other tables

| Table | Purpose |
|-------|---------|
| `events.tracking_plans` | Every uploaded version of an app's plan, with a SHA-256 hash; the latest one applies |
| `events.event_ids` | Seen event ids for deduplication, with the receive time |

## Retention and privacy

- Raw events with identifiers: 26 months, then anonymized (identifiers
  removed, time rounded to the day). Needs legal review.
- On account deletion the user's events are deleted or anonymized.
- Aggregates and trained models are kept without limit.
- No IP addresses, no precise location, no free text.

## Useful queries

```sql
-- Latest events
select name, properties, session_id, valid, invalid_reason, occurred_at
from events.events order by received_at desc limit 20;

-- Events that do not match the plan
select name, invalid_reason, count(*)
from events.events where not valid group by 1, 2 order by 3 desc;

-- Events per day
select date_trunc('day', occurred_at) as day, name, count(*)
from events.events group by 1, 2 order by 1 desc, 3 desc;

-- Which partition holds which rows
select tableoid::regclass as partition, count(*) from events.events group by 1;

-- Uploaded plan versions
select a.slug, p.created_at, p.plan_hash
from events.tracking_plans p join apps.apps a on a.id = p.app_id
order by p.created_at desc;
```

## Not implemented yet

- Anonymization after 26 months and on account deletion (needs the job queue)
- Cleanup of old `event_ids` rows (needs the job queue)
- Alerts on invalid events (with the alerts system; a log warning for now)
- GeoIP database file on the server (with deployment; the code is ready)
- Device details with analytics consent
- Plan upload from the admin panel or CI (script for now)
