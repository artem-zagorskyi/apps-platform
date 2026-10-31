# Background jobs and webhooks

Work that must not happen while a phone waits for a response: deliveries
that need retries over days, erasures that take a while, and maintenance on
a schedule.

## Job queue

[pg-boss](https://github.com/timgit/pg-boss) 12 keeps jobs in Postgres, in its
own schema `pgboss`, which it creates and migrates itself (our migrations do
not touch it). Jobs survive restarts and are retried with exponential backoff.

- **Workers run in the server process** (`server.ts` starts them after the
  app and stops them after HTTP on shutdown). They can move to their own
  process later without changing job code.
- **Jobs inside a transaction.** `sendJob(name, data, tx)` creates the job in
  the caller's Drizzle transaction: if the change rolls back, the job does
  not exist. Example: account deletion marks the user and queues the erasure
  atomically.
- **Delays.** `sendJob(name, data, tx, { startAfterSeconds })`.
- **Job data is JSON** stored in the database; handlers validate it with zod.

Code: `src/core/jobs.ts`. Modules declare their jobs in
`src/modules/<module>/jobs.ts` as `JobDefinition[]`; `server.ts` collects them.

### Adding a job

1. Write the work as a plain function taking `now` or its input (easy to test).
2. Add a `JobDefinition` to the module's `jobs.ts`: `name` (module prefix,
   letters, digits, hyphens), optional `schedule` (cron, UTC), retry and
   expiry settings, a `handler` that validates its data.
3. Add the module's list to `startJobs([...])` in `server.ts` if it is new.
4. Test the function directly. Code that sends jobs is tested through
   `queuedJobs` (see Tests).

Queue settings apply when a queue is created; changing them later for an
existing queue needs `updateQueue` or a new queue name.

### Scheduled jobs

Scheduled queues use the `stately` policy: at most one waiting and one
running job, so a stopped worker does not pile up a backlog.

| Job | Schedule (UTC) | Does |
|-----|----------------|------|
| `identity-delete-old-nonces` | hourly at :05 | Deletes nonces expired more than a day ago |
| `identity-delete-old-sessions` | daily 03:45 | Deletes sessions that ended (revoked, rotated, expired) more than 90 days ago, rotation chains at once |
| `events-ensure-partitions` | daily 03:15 | Creates month partitions for the current and next two months (also run at start-up) |
| `events-delete-old-ids` | daily 03:30 | Deletes deduplication ids older than 90 days |
| `webhooks-delete-old-deliveries` | daily 03:50 | Deletes webhook deliveries older than 90 days |
| `identity-erase-overdue` | daily 04:20 | Safety net: erases users whose erasure is more than an hour late (logs a warning) |
| `identity-delete-old-consents` | daily 04:40 | Deletes consent records of users deleted more than three years ago |

### Jobs on demand

| Job | Sent by | Retries |
|-----|---------|---------|
| `webhooks-deliver` | `notifyApp` | 20, from 30 s doubling up to 6 h: about three days |
| `identity-erase-user` | `DELETE /v1/me`, 20 minutes later | 10, from 1 min up to 1 h |

### Tests

- Most tests run without a queue. `test/setup.ts` installs a fallback, so
  `sendJob` records jobs in `queuedJobs` (`test/jobs.ts`) instead of sending
  them. The fallback ignores transactions.
- `src/core/jobs.test.ts` runs a real queue on the test database: a job runs,
  a failing job is retried. It waits a few seconds for polling.

### Useful queries

```sql
select name, policy, retry_limit from pgboss.queue order by name;
select name, cron from pgboss.schedule order by name;
select name, state, retry_count, created_on, completed_on
from pgboss.job order by created_on desc limit 20;
```

Table names are those of pg-boss 12; `\dt pgboss.*` lists them.

## Webhooks to app backends

The platform tells an app's own backend about changes it must act on.

| Type | When | `data` |
|------|------|--------|
| `user.merged` | An anonymous user was merged into an existing account | `mergeId`, `sourceUserId`, `targetUserId`, `strategy` (`keep_target`, `keep_source`, `merge`), `mergedAt` |
| `user.deleted` | A deleted account was erased | `userId`, `mergedUserIds` (users merged into it earlier), `deletedAt` |

The backend moves domain data on `user.merged` (by the strategy) and
deletes the user's domain data on `user.deleted`.

### Setting the endpoint

```bash
pnpm webhooks:set <app slug> https://backend.example.com/platform-webhooks
pnpm webhooks:set <app slug> off
```

Setting prints a new signing secret (`whsec_...`) once; give it to the
backend. The secret is stored encrypted (AES-256-GCM with
`DATA_ENCRYPTION_KEY`). Running the command again rotates the secret.
Production requires `https`.

### Request

```
POST <endpoint>
content-type: application/json
user-agent: apps-platform-webhooks
x-platform-delivery: <delivery id>
x-platform-signature: t=<unix seconds>,v1=<hex>

{"id":"<delivery id>","type":"user.merged","appId":"...","createdAt":"...","data":{...}}
```

- `v1` is HMAC-SHA256 with the secret over `<t>.<raw body>`.
- Any `2xx` counts as delivered. Anything else, a timeout (10 s) or a
  redirect counts as a failure and is retried for about three days.
- The same notification may arrive more than once (a lost response).
- Without an endpoint the delivery is marked `no_endpoint` and not retried.

### Verifying on the backend (Node.js)

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

// rawBody: the request body exactly as received, before JSON parsing
export function verifyPlatformWebhook(rawBody, signatureHeader, secret, now = Date.now()) {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signatureHeader ?? '');
  if (!match) return false;
  const [, t, received] = match;

  // Reject old requests: a captured notification cannot be replayed later
  if (Math.abs(now / 1000 - Number(t)) > 5 * 60) return false;

  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(received, 'hex'));
}
```

Then drop deliveries whose `x-platform-delivery` id was already handled, and
answer `2xx` only after the change is stored.

### Storage

| Table | Contents |
|-------|----------|
| `webhooks.endpoints` | One per app: URL, encrypted secret |
| `webhooks.deliveries` | Type, payload, attempts, last status and error, `delivered_at`; kept 90 days |

```sql
select type, attempts, last_status, last_error, delivered_at, created_at
from webhooks.deliveries order by created_at desc limit 10;
```

### Local check

A fake backend that prints what it receives:

```bash
node -e "require('http').createServer((q,s)=>{let b='';q.on('data',d=>b+=d);q.on('end',()=>{console.log(q.headers['x-platform-signature']);console.log(b);s.end('ok')})}).listen(4000)"
pnpm webhooks:set demo http://127.0.0.1:4000/platform-webhooks
```

## Not implemented yet

- Workers in their own process (when jobs start to slow down requests)
- Redelivery of failed or `no_endpoint` notifications from the admin panel
- A shared JS package with `verifyPlatformWebhook` for app backends
- Purchase notifications (with subscriptions)
