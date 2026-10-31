# Account deletion

Every user can delete their account, anonymous users too: the right to
erasure does not depend on a linked account. Deletion is immediate and
cannot be undone.

Google Play requires a deletion path in the app (done) and a web page where
deletion can be requested without the app (planned, with the website or
admin panel).

## Flow

```
DELETE /v1/me ──> user deletion_pending, sign-in and sessions gone at once,
                  device handed to a fresh anonymous user
     │
     └─ 20 min later: identity-erase-user
          1. anonymize events (repeatable)
          2. delete account data, user deleted
          3. user.deleted to the app backend
```

### `DELETE /v1/me`

Auth required. Rate limit 5/min per IP. No body. Response `200`: a token
pair of the fresh anonymous user on this device, as for logout.

In one transaction:

1. The user becomes `deletion_pending` (`deletion_requested_at`,
   `deletion_scheduled_at`).
2. Linked accounts (Google, Apple) are removed: signing in with the same
   account starts a new, empty account.
3. Every session of the user is revoked (`account_deleted`). Other devices
   get `401 invalid_refresh_token` on their next refresh and start over as
   new anonymous users.
4. This device is handed to a new anonymous user; device data collected with
   consent is cleared.
5. The erase job is queued with a delay.

`401` when the user is not active anymore (a second request) or the device
belongs to someone else.

### Why the erasure waits 20 minutes

Access tokens stay valid up to 15 minutes. Until then another device of the
user could still send events under the old id. The erasure starts after
`ACCESS_TOKEN_TTL_SECONDS` plus 5 minutes, when no valid token is left.

### Erase job

For the deleted user **and every user merged into them** (their history
became the person's history):

1. **Events are anonymized first**: user, installation and session ids are
   replaced by new random ids, one new user id for the person, one per
   original installation and session. The mapping is never stored. Counts,
   funnels and sessions keep their shape. Repeatable: anonymized rows no
   longer match.
2. **Account data, in one transaction**: sessions, linked accounts, nonces,
   device data of installations, merge records are deleted; the user becomes
   `deleted` with `deleted_at`.
3. **`user.deleted`** goes to the app backend in the same transaction
   ([webhooks](jobs.md#webhooks-to-app-backends)), so it deletes its domain data.

Events come first on purpose: a failure after them leaves the user
`deletion_pending`, so the retry runs everything again. Marking the user
`deleted` first would make a retry skip the events.

A daily safety net (`identity-erase-overdue`) erases users whose erasure is
more than an hour late.

## What stays

| Data | Kept | Why |
|------|------|-----|
| User row | As a tombstone: status, deletion times | Old tokens are refused; the consent log refers to it |
| Consent log | Three years after deletion, then deleted daily | Proof of lawful processing (German limitation period) |
| Anonymized events | Like all events | Statistics; no link to the person |
| Webhook delivery of `user.deleted` | 90 days | Delivery history |
| Installation rows | Without device data | Referenced by the consent log |

Needs legal review, like the 26-month event retention.

## SDK

`platform.deleteAccount()` (see [requirements.md](../sdk/requirements.md#account-deletion)):
the device gets the fresh user, `userChanges` reports `accountDeleted`,
consent and config reset, and events still queued for the deleted user are
dropped, not sent.

## Useful queries

```sql
-- Pending and recent deletions
select id, status, deletion_requested_at, deletion_scheduled_at, deleted_at
from identity.users where status in ('deletion_pending', 'deleted')
order by deletion_requested_at desc;

-- Nothing left under a deleted id
select count(*) from events.events where user_id = '<deleted user id>';
```

## Not implemented yet

- Web page for deletion requests without the app (Google Play requirement)
- Revoking Apple tokens (with Apple sign-in)
- Deletion requests from the admin panel (support cases)
