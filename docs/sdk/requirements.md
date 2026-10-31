# Flutter SDK requirements

What the Flutter SDK must do to work with the platform server as it exists
today, and what a wrapper app must provide on top of it. This is the contract
for the SDK, not its final API. Server details: [identity.md](../platform/identity.md),
[events.md](../platform/events.md), [config.md](../platform/config.md).

## Responsibilities

| Layer | Owns |
|-------|------|
| SDK (`sdk/flutter/`) | Installation id, tokens, every call to the platform server, retries, refresh, provider sign-in plumbing, user change notifications, consent state, event queue and standard events, remote config and exposures |
| Wrapper app | Screens and texts, the merge dialog, the consent screen, its own tracking plan and parameter declarations, deciding what counts as local progress, reacting to user changes, app-specific configuration |

The wrapper app never talks to platform endpoints directly and never touches tokens.

## Configuration

The app initializes the SDK once at startup with:

- `appId`: the app's id on the platform
- `baseUrl`: platform server URL
- Google `serverClientId`: the OAuth client ID that must appear in the token's
  `aud`; it must be registered in `apps.oauth_clients`

The platform (`android` / `ios`), OS version, app version and build are
detected by the SDK.

## Local storage

| Value | Where | Why |
|-------|-------|-----|
| Installation id | Secure storage | Identifies the device; must survive restarts |
| User id | Secure storage | Current owner of the device |
| Refresh token | Secure storage | Long-lived secret |
| Refresh token expiry | Secure storage | Decide whether a session can be resumed |
| Access token | Memory only | Short-lived; a new one is obtained on start |
| Consent decisions, unsent decisions | Secure storage | Apply at once, also offline |
| Usage state: last app version, current session | Secure storage | Install and update detection, sessions across restarts |
| Event queue | SQLite file `app_platform_events.db` | Events wait here until the server confirms them |
| Remote config: active, pending, ETag, fetch time | Secure storage | Values without a network; the next config waits for the next launch |

Secure storage: `flutter_secure_storage` (Android Keystore, iOS Keychain).

**Exclude SDK storage from Android Auto Backup and device transfer**: the
secure storage (`sharedpref`) and the event database. A restored
installation id on a second device would make two devices share one id;
restored encrypted values also fail to decrypt because Keystore keys are not
backed up; queued events belong to this installation. On iOS, store Keychain
items with "this device only" accessibility for the same reason.

Uninstalling the app erases this storage. A reinstalled app is a new
anonymous user unless the person signs in with Google again. The app should
therefore offer "save progress with Google" at good moments.

## Start-up

1. Read the installation id. If there is none, generate a UUID and store it.
2. If a refresh token is stored and not expired, refresh (see below).
3. Otherwise call `POST /v1/auth/anonymous`.
   - `409 installation_exists`: generate a new installation id, store it, retry.
4. Store user id and tokens **before** doing anything else with them.
5. Load stored consent decisions, then sync them with the server in the background.
6. Open the event queue, record the standard launch events, send queued events.
7. Load the stored config. On the first launch wait up to 1.5 seconds for
   the server; otherwise apply the config fetched during the previous launch
   and fetch the next one in the background.

`init` never fails because of the network: it waits for the server at most
3 seconds for the session (plus 1.5 seconds for the config on the first
launch), then continues offline. Calls that need the server wait for the
start-up to finish.

## Authenticated requests

- Every request carries `Authorization: Bearer <accessToken>`.
- Refresh proactively when the access token expires in less than a minute.
- On `401 unauthorized`: refresh once and retry the request once. A second
  `401` is returned to the caller.

## Refresh

- **Single flight.** At most one refresh runs at a time. Concurrent callers
  wait for the same result. Two parallel refreshes with the same token are
  handled by the server, but they waste the grace window and make theft
  detection noisier.
- **Persist first.** Store the new refresh token immediately when the
  response arrives. If the app dies after the server rotated the token but
  before it was stored, the old token works again only within the 30-second
  grace window; after that the server treats it as stolen.
- Network errors and `5xx`: keep the current tokens and retry later with
  backoff. Never discard a session because of a network problem.
- `401 invalid_refresh_token`: the session is dead. Clear the stored session,
  **generate a new installation id** (the old one still exists on the server
  and would get `409`), sign up anonymously and emit a user change. If the
  person had linked Google, they get their account back by signing in again.

## Google sign-in

1. `POST /v1/auth/nonce` → `nonce`.
2. Run Google sign-in (Credential Manager) with `serverClientId` and the
   **raw** nonce. Google returns an ID token.
3. `POST /v1/auth/google` with `{ idToken }`.
4. Handle the result:

| Response | SDK behaviour |
|----------|---------------|
| `linked`, `already_linked` | Keep tokens; refresh the cached profile |
| `409 account_exists` | Ask the app to resolve the conflict (below); retry with the **same** `idToken` and `mergeStrategy`. Cancel means doing nothing |
| `signed_in` | Store the new tokens and user id, emit a user change with the chosen strategy |
| `409 already_signed_in` | Report to the app: the person must sign out first |
| `409 provider_already_linked` | Report to the app: another Google account is linked |
| `409 account_unavailable` | Report to the app: the account cannot be used |
| `401 invalid_provider_token` | Start again from step 1 (new nonce) |

The nonce lives 10 minutes. The merge dialog must finish within that time,
otherwise the retry fails and the flow starts again.

### Resolving a conflict

`signInWithGoogle(resolveConflict: ...)` takes one callback. The SDK calls it
on `409 account_exists` and retries with the **same** ID token and the
returned strategy:

- `MergeStrategy.keepTarget`: progress of the existing account
- `MergeStrategy.keepSource`: progress of this device
- `MergeStrategy.merge`: combine both
- `null`: cancel; nothing changes

The app returns `keepTarget` without asking when this device has no progress
worth keeping, and shows its own dialog otherwise. Whatever is chosen, the
device becomes the existing account's user; the strategy tells the app
backend what to do with the domain data.

On Android the SDK calls Credential Manager directly from its own Kotlin
code, because a fresh server nonce must be passed with every sign-in.

## Apple sign-in (later, iOS only)

Same flow as Google, except: the app passes `sha256(nonce)` to Apple, and
sends the authorization code together with the ID token, because the server
must exchange it on the first link. Not available until the server supports it.

## Logout

- `POST /v1/auth/logout`. On success store the returned tokens (a fresh
  anonymous user on the same device) and emit a user change.
- `409 no_linked_account`: anonymous users cannot sign out. The app offers to
  link Google instead.
- Queued events of the current user are sent first, while their token is
  still valid.

## Current user

`GET /v1/me` returns the user id, installation, platform, creation time and
linked providers with emails. The SDK refreshes it after any sign-in change.

## Consent

`AppPlatform.consent` (`ConsentManager`):

- `state` is a `ValueListenable<ConsentState>`: `status` (`needsDecision`,
  `decided`, `notRequired`), whether analytics and personalization are
  allowed, the policy version and when the app may ask again.
- `record(analytics:, personalization:, source:)` applies at once, also
  offline, and is sent to the server when possible: at start-up, on the next
  decision, before events are sent or on a user change.
- The status is computed on the device with the server's rules. An unknown
  policy (never reached the server) means "ask".
- Nothing is allowed without a decision, except under mode `none`.
- A new policy version asks again; the previous choice applies meanwhile.
- A decision made before the first user existed is sent once the user is
  created, with the current policy version.
- Logout, session reset and merge reset local decisions; the new user's
  server decisions apply, otherwise the person is asked.

The app draws the consent screen: nothing pre-selected, rejecting as easy as
accepting, must be answered. It shows the screen whenever the status becomes
`needsDecision` and offers toggles in its settings.

## Events

### Tracking plan and generated code

The app keeps its own `tracking_plan.yaml` (format:
[events.md](../platform/events.md#tracking-plan)) and generates typed code
with the SDK's generator:

```bash
dart run renvix_sdk:events tracking_plan.yaml \
  --dart-out=lib/events.g.dart --json-out=tracking_plan.json
```

The JSON is uploaded to the server for every new plan version
(`pnpm plan:upload <app slug> tracking_plan.json`) **before** a release that
sends the new events. Otherwise they are stored as invalid. The app uses the
generated class:

```dart
final events = AppEvents(platform.events);
events.lessonCompleted(lessonId: 'a1', mistakes: 2);
```

### Queue and upload

`AppPlatform.events` (`EventManager`):

- **Consent first.** Analytics events are not recorded at all without
  analytics consent. Essential events are always recorded. Withdrawing
  consent deletes queued analytics events.
- **Durable queue.** Every event is written to SQLite with a UUID v7 id, the
  device time, the current user, session and app version. It stays there
  until the server accepts or rejects it.
- **Batches** of up to 100 events. Upload triggers:
  - every 30 seconds;
  - after 50 new events;
  - when the app goes to the background;
  - before a user switch (logout, merge), while the old token still works;
  - at start-up.
- **Single flight**: one upload at a time.
- **Pending consent first.** Unsent consent decisions are sent before events,
  so the server does not reject them with `no_consent`.
- **Offline.** Failures keep the events queued for the next trigger. Beyond
  10,000 queued events the oldest analytics events are dropped; essential
  ones are kept.
- **User switch.** Events of a previous user still in the queue cannot be
  sent with the new user's token and are dropped.
- **Never crash the app.** Storage and network errors in background uploads
  are swallowed; `flush()` throws for callers who want to know.
- `queuedCount()` returns the queue size, for debug screens.

### Standard events and sessions

The SDK records install, update, app opens and sessions itself (list:
[events.md](../platform/events.md#standard-platform-events)) from the app
lifecycle (`AppLifecycleListener`):

- A session continues if the app returns within 30 minutes, even after the
  process was stopped. Its id is attached to every event
  (`AppPlatform.sessionId`).
- Before analytics consent only the facts "install not recorded" and
  "session start not recorded" are kept. The events follow once consent is given.
- `platform.trackScreen('lesson_list')` records `screen_viewed`. The app calls
  it on every screen change with short, fixed screen names.

## Remote config

### Declarations and generated code

The app keeps its own `remote_config.yaml` (format:
[config.md](../platform/config.md#parameter-declarations)) and generates a
typed class with the SDK's generator:

```bash
dart run renvix_sdk:config remote_config.yaml \
  --dart-out=lib/remote_config.g.dart --json-out=remote_config.json
```

The JSON is uploaded with `pnpm config:schema <app slug> remote_config.json`
**before** a config document uses the new parameters. The app reads values
through the generated class:

```dart
final config = AppConfig(platform.config);
if (config.paywallVariant == PaywallVariant.trialFirst) { ... }
```

Every getter returns the server value for this user, or the built-in
default when there is none or it does not fit this app version. App tests can
use fixed values: `AppConfig(const ConfigValues({'ads_enabled': false}))`.

### When values change

`AppPlatform.config` (`ConfigManager`) is a `Listenable`: listeners are
notified whenever the values in use change.

| Moment | Behaviour |
|--------|-----------|
| First launch | Wait up to 1.5 s for the server. An answer in time applies at once; a late one waits for the next launch |
| Later launches | The config fetched during the previous launch applies; the next one is fetched in the background |
| Back from the background | Fetch again when the last fetch is older than an hour |
| User change (merge, logout, session reset) | The previous user's config is dropped at once (defaults); the new user's applies as soon as it arrives |
| `config.fetch()` | Fetch now; the result waits (`hasPending`) |
| `config.activate()` | Apply a fetched config now, e.g. for an urgent kill switch |

Values never change in the middle of a launch on their own, so a person does
not see a screen switch variants under their hands.

Requests carry the running app version and the ETag of the newest fetched
config; `304` keeps it. Answers that arrive after a user change belong to the
previous user and are dropped. A stored config of another user is ignored
at start-up.

### Exposures

Reading a parameter whose value comes from an experiment records
`experiment_exposed` once per session and variant: not for forced testers,
not when the value does not fit this app version, not without analytics
consent (the next read after consent records it). The app therefore reads a
parameter where the person sees its effect, not in advance.

## User changes

The SDK exposes a stream of user changes with the reason: `signed_up`,
`merged` (with strategy), `logged_out`, `session_reset`. The app must react
by reloading or clearing everything tied to the previous user: local domain
database, caches, in-memory state. This is the most common source of bugs
("the previous user's data is still on screen").

## Errors

The SDK maps server responses to typed errors by `error` code (see the table
in [identity.md](../platform/identity.md#error-codes)). Network failures,
`429` and `5xx` are reported separately so the app can show "try again later".

## Minimum the wrapper app must provide

- SDK initialization with `appId`, `baseUrl`, Google `serverClientId`.
- Google Cloud setup: OAuth client for Android with the package name and the
  SHA-1 of every signing key (debug, upload, Play app signing), plus the
  server client ID registered in `apps.oauth_clients`.
- Android backup rules excluding the SDK storage and event database.
- An account screen: current state (anonymous or linked email), "Sign in with
  Google", "Sign out".
- The merge dialog, skipped when the device has no progress worth keeping.
- The consent screen and consent toggles in settings.
- Its tracking plan, generated code, and the plan uploaded before release.
- Its parameter declarations, generated config class, and the declarations
  uploaded before a config uses them.
- `trackScreen` on screen changes.
- Handling of user changes: reload or clear local data.
- A prompt to save progress with Google after meaningful progress.
- Later: account deletion entry point (required by Google Play), paywall.

## Later systems in the SDK

Each will get its own section when the server part is designed:

- **Device details**: collected and sent only with analytics consent.
- **Sync**: local database, outbox, pull by cursor.
- **Subscriptions**: Play Billing with `obfuscatedAccountId`, server
  verification, entitlements.
- **Push**: FCM token registration, open tracking.

## Testing

The SDK is tested on the host without a device:

- API client and session manager against a fake API: single-flight refresh
  under concurrent calls, retry after `401`, `409 installation_exists`,
  session reset, persistence order, offline start.
- Google sign-in with a fake credential provider: the merge flow with the
  same ID token.
- Consent and events against an in-memory SQLite (`sqflite_common_ffi`):
  consent gating, withdrawal, offline queue, user switches, upload triggers.
- Standard events with a fake clock: sessions, restarts, updates, consent later.
- Config generator and value checks; the config manager against the fake API:
  first launch wait, late answers, pending and activate, ETag, user changes,
  offline, exposures.

An end-to-end check runs the demo app on the emulator against a local
platform server.
