# Offline-first sync: design

Status: designed, not implemented. Build it together with the first real app
that needs offline data, and validate the engine on that app's entities.

## Scope

Sync is an **optional toolkit for apps**, not part of the platform. App data
(notes, lessons, workouts) belongs to the app's own backend and database. The
platform never stores it and does not know how it gets there.

| Part | Where | Does |
|------|-------|------|
| Client engine | SDK (`sdk/flutter`), optional module | Local database, outbox, push, pull, conflict handling |
| Server engine | `packages/sync-server` (TypeScript) | Fastify plugin an app backend mounts on its own tables |
| Code generator | SDK `bin/` | One schema → Dart models and local tables, server table definitions and validation |
| Demo backend | `examples/demo-backend` | A small backend on the plugin, with its own database |

The server engine should not depend on anything app-specific, so it could
later also run inside the platform as a generic store for apps without a
backend.

## Requirements

- **Offline first.** Every change applies locally at once; the screen
  updates without a network. Changes reach the server when possible.
- **No lost changes.** A change leaves the device only after the server
  confirmed it.
- **Concurrent edits.** Two devices editing different fields of one record
  keep both edits. The same field: the later edit wins.
- **Clock independence.** "Later" must not depend on correct device clocks.
- **Deletions propagate** to every device of the user.
- **New devices and reinstalls** receive everything.
- **User changes** never mix data of two users on a device.
- **Server is authoritative**: it validates and may refuse changes; the
  device then takes the server value.
- **Ownership from the token**: a device can only touch its user's records.

## Schema

One file in the app repository, `sync_schema.yaml`:

```yaml
collections:
  notes:
    fields:
      title: { type: string, max_length: 200 }
      body: { type: string, max_length: 10000 }
      color: { type: enum, values: [none, yellow, green, blue], default: none }
      pinned: { type: boolean, default: false }
```

- Types like tracking plans and parameters (boolean, integer, number, string,
  enum), plus `datetime` and references to other collections (later).
- The schema only grows: fields are deprecated, never removed or retyped.
- Generated for the device: a model class, a local table, typed access
  (`sync.notes.put(note)`, `sync.notes.watchAll()` as a stream for the UI).
- Generated for the backend: a Drizzle table definition and validation of
  incoming changes.

Service fields added by the engine to every record: `id` (UUID v7 created on
the device, so records can be created offline), `user_id` (server side),
`deleted` marker, a clock per field, the server change number.

## Protocol

### Push (outbox)

- A local change is one SQLite transaction: the record **and** an outbox
  row ("note X: title and pinned changed, with their clocks").
- The outbox is sent in batches (start-up, after changes, going to the
  background, before a user switch), like the event queue.
- The server applies each field only if its clock is newer than the stored
  one, and answers per change: applied, outdated (ignored) or refused (with
  a reason). The device removes confirmed rows from the outbox.

### Pull (cursor)

- Every change on the server gets the next number **of that user**.
- The device asks: "my changes after number N" and receives changed records
  and the new cursor, in pages.
- A user's writes are serialized on the server (a lock on the user's counter
  row), so numbers follow commit order. Otherwise a change numbered 1519
  committed after 1520 would be skipped forever.
- Own changes coming back are harmless: applying them is idempotent.
- Cursor 0 means a full download (new device, reinstall).

### Conflicts

- Last write wins **per field**, not per record.
- Order by a **hybrid logical clock** (HLC): device time corrected by the
  server time sent with every response, plus a counter for equal times and
  the installation id as a tie-breaker.
- The server's decision is final; refused changes are replaced by the server
  value on the next pull.

### Deletions

- Deleting sets the `deleted` marker (a tombstone); the record is hidden
  locally and on other devices after their next pull.
- Tombstones are purged after 90 days. A device whose cursor is older than
  the purge horizon gets a full resync.

## Local storage

The SDK owns a separate SQLite database for synced collections (sqflite, as
for the event queue), one per user, excluded from backups. Apps keep their
non-synced local data wherever they like (drift is fine).

| Table | Contents |
|-------|----------|
| One per collection | Fields, `id`, `deleted`, field clocks |
| `outbox` | Collection, record id, changed fields with values and clocks, created at |
| `sync_state` | Cursor per user, last pull time, server clock offset |

## Server storage (in the app backend's database)

| Table | Contents |
|-------|----------|
| One per collection | Fields, `id`, `user_id`, `deleted`, `field_clocks` (jsonb), `change_seq`, `updated_at` |
| `sync_users` | Per user: last change number (the lock for serialized writes) |

Index per collection: `(user_id, change_seq)` for pulls.

## Integration with the platform

Sync touches the platform only through the contract every app backend uses:

1. **Tokens.** The backend verifies platform access tokens with the
   platform's JWKS: signature, issuer, `aud` = its app id, expiry. `sub` is
   the user id.
2. **Webhooks.** `user.merged`: the backend moves the source user's records
   by the strategy (`keep_target`: drop them; `keep_source`: replace the
   target's; `merge`: keep both). `user.deleted`: delete the user's records.
3. **User changes in the SDK.** Before a logout or merge the outbox of the
   current user is pushed (a hook before the user switch). After any user
   change the local database of the previous user is cleared and the new
   user's data is pulled. After an account deletion the outbox is dropped,
   not pushed.
4. **Requests to the app backend** carry a valid platform token, renewed and
   retried once on `401`, through the SDK.

Right after a merge the device may first see the account's data without the
merged records: the webhook reaches the backend a few seconds later, and the
next pull brings the combined data.

## Build order (when needed)

1. Schema format and generator (Dart models and local tables; Drizzle tables
   and validation for the backend).
2. Server engine: push with per-field clocks, pull by cursor, serialized
   writes per user, tombstones, purge.
3. Demo backend: token verification, the plugin, webhook handlers for merge
   and deletion.
4. Client engine: local database, outbox, HLC, push and pull triggers, user
   changes, watch streams.
5. Demo screen on the app's real entity; end-to-end checks with two
   emulators: offline edits, concurrent edits of one record, deletions,
   reinstall, merge, account deletion.
6. Documentation.

## Open questions

- References between collections and what happens when the referenced
  record is deleted.
- Large binary data (images): probably separate upload to object storage,
  only the reference synced.
- Shared records between users (collaboration): out of scope for the first
  version; every record has exactly one owner.
- Live updates (push to other devices immediately): later, through silent
  push notifications that trigger a pull.
