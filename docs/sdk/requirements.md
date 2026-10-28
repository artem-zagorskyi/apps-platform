# Flutter SDK requirements

What the Flutter SDK must do to work with the platform server as it exists
today, and what a wrapper app must provide on top of it. This is the contract
for the SDK, not its final API. Server details: [identity.md](../platform/identity.md).

## Responsibilities

| Layer | Owns |
|-------|------|
| SDK (`sdk/flutter/`) | Installation id, tokens, every call to the platform server, retries, refresh, provider sign-in plumbing, user change notifications |
| Wrapper app | Screens and texts, the merge dialog, deciding what counts as local progress, reacting to user changes, app-specific configuration |

The wrapper app never talks to identity endpoints directly and never touches tokens.

## Configuration

The app initializes the SDK once at startup with:

- `appId`: the app's id on the platform
- `baseUrl`: platform server URL
- Google `serverClientId`: the OAuth client ID that must appear in the token's
  `aud`; it must be registered in `apps.oauth_clients`
- app version and build (from the package info)

The platform (`android` / `ios`) and OS version are detected by the SDK.

## Local storage

| Value | Where | Why |
|-------|-------|-----|
| Installation id | Secure storage | Identifies the device; must survive restarts |
| User id | Secure storage | Current owner of the device |
| Refresh token | Secure storage | Long-lived secret |
| Refresh token expiry | Secure storage | Decide whether a session can be resumed |
| Access token | Memory only | Short-lived; a new one is obtained on start |

Secure storage: `flutter_secure_storage` (Android Keystore, iOS Keychain).

**Exclude SDK storage from Android Auto Backup.** A restored installation id
on a second device would make two devices share one id; restored encrypted
values also fail to decrypt because Keystore keys are not backed up. On iOS,
store Keychain items with "this device only" accessibility for the same reason.

Uninstalling the app erases this storage. A reinstalled app is a new
anonymous user unless the person signs in with Google again. The app should
therefore offer "save progress with Google" at good moments.

## Start-up

`AppPlatform.init(appId, baseUrl)` collects the app and OS version and starts the
session. It never fails because of the network and waits for the server at
most 3 seconds; the rest continues in the background.

1. Read the installation id. If there is none, generate a UUID and store it
   immediately, before any request: data collected offline is tied to it.
2. If a session is stored, refresh it. Offline, the stored user id is used
   and the refresh is retried on the next request.
3. If no session is stored, sign up anonymously.
   - `409 installation_exists`: retry with a new installation id (up to 3 times).
   - Offline: `userId` stays null; sign-up is retried on the next request.
     The app keeps working locally.
4. Persist tokens **before** using them.

Configuration errors (for example `400 unknown_app`) make `init` fail.

`userChanges` reports switches after `init`. The user created during start-up
is read from `userId` after `init`.

An app that cannot work without the server (for example, all content comes
from it) checks `userId` after `init` and asks the person to connect. This
is the app's decision, not the SDK's.

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
- `401 invalid_refresh_token` (or a refresh token expired on the device):
  the session is dead. Sign up **first** with a new installation id (the old
  one still exists on the server and would get `409`), then replace the
  stored installation id and session and emit `sessionReset`. If sign-up
  fails because the device is offline, nothing is replaced: the app keeps
  the old user id until the next attempt. If the person had linked Google,
  they get their account back by signing in again.

## Google sign-in

1. `POST /v1/auth/nonce` → `nonce`.
2. Run Google sign-in (`google_sign_in` / Credential Manager) with
   `serverClientId` and the **raw** nonce. Google returns an ID token.
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

## Current user

`GET /v1/me` returns the user id, installation, platform, creation time and
linked providers with emails. The SDK caches it and refreshes it after any
sign-in change.

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
- An account screen: current state (anonymous or linked email), "Sign in with
  Google", "Sign out".
- The merge dialog and the `hasLocalProgress` decision.
- Handling of user changes: reload or clear local data.
- A prompt to save progress with Google after meaningful progress.
- Later: consent screen, account deletion entry point (required by Google
  Play), paywall.

## Later systems in the SDK

Each will get its own section when the server part is designed:

- **Consent**: show the screen per regional policy, record choices, gate
  analytics and ads, re-prompt timing.
- **Device details**: collected and sent only with analytics consent.
- **Events**: typed events generated from the tracking plan, local queue in
  SQLite, batched upload, essential vs analytics categories.
- **Sync**: local database, outbox, pull by cursor.
- **Config & experiments**: cached config with built-in defaults, exposure events.
- **Subscriptions**: Play Billing with `obfuscatedAccountId`, server
  verification, entitlements.
- **Push**: FCM token registration, open tracking.

## Testing

The SDK is tested against a mocked HTTP client: single-flight refresh under
concurrent calls, retry after `401`, `409 installation_exists`, session reset,
the merge flow with the same ID token, and persistence order. An end-to-end
check runs a demo app against a local platform server.