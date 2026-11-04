# App accounts (external sign-in)

Apps may have their own accounts: email and password, phone, a provider the
platform does not know. The app backend checks the login its own way and
confirms it to the platform with a signed **identity assertion**. The
platform then treats the account like a Google or Apple account: linking,
merging, signing in on another device, logout, deletion.

Google and Apple tokens the platform verifies itself; every other way of
signing in goes through the app backend as provider `external`.

## Flow

```
SDK ──POST /v1/auth/nonce──> platform            nonce
SDK ──login form + nonce──> app backend          checks the login its own way
app backend ──assertion──> SDK                   createIdentityAssertion(...)
SDK ──POST /v1/auth/external──> platform         linked / already_linked / signed_in / 409 account_exists
```

## Keys

The backend signs with a private key; the platform keeps the public half in
`apps.identity_keys` (several per app, for rotation).

```bash
pnpm identity:key <app slug>                  # registers a new key, prints PLATFORM_IDENTITY_KEY once
pnpm identity:key <app slug> --revoke <kid>   # stops accepting a key
```

Rotation: create a new key, switch the backend to it, revoke the old one.
The private key belongs only in the backend's secrets, never in the app.

## Assertion

A JWT signed with `EdDSA` or `ES256`:

| Field | Value |
|-------|-------|
| header `kid`, `alg` | The registered key |
| `iss` | The app id: an assertion works only in its own app |
| `aud` | The platform (`JWT_ISSUER`, default `apps-platform`) |
| `sub` | Stable account id in the app's own system, up to 255 characters; never a placeholder such as `undefined`, `null` or `0` |
| `nonce` | The nonce the SDK got from the platform, unchanged |
| `email`, `email_verified` | Optional |
| `iat`, `exp` | Accepted for at most 10 minutes after `iat` (enough for the merge dialog) |

`createIdentityAssertion` in `@apps-platform/platform-client` produces it:

```ts
const assertion = await createIdentityAssertion({
  privateKey: process.env.PLATFORM_IDENTITY_KEY!,
  appId: process.env.PLATFORM_APP_ID!,
  subject: account.id,
  nonce: request.body.nonce,
  email: account.email,
});
```

## `POST /v1/auth/external`

Auth required. Rate limit 20/min per IP.

```json
{ "assertion": "<JWT>", "mergeStrategy": "keep_target | keep_source | merge (only on retry)" }
```

Responses and conflicts are those of `POST /v1/auth/google`: `linked`,
`already_linked`, `signed_in` with tokens, `409 account_exists` (retry with
the same assertion and a strategy), `409 already_signed_in`,
`409 provider_already_linked`, `409 account_unavailable`,
`401 invalid_provider_token`.

The platform refuses an assertion with an unknown or revoked key, another
key with the same `kid`, another app as issuer, another audience, an age
over 10 minutes, a nonce not issued to this device, a nonce already used, or
a subject that is blank or a placeholder (`undefined`, `null`, `none`,
`nan`, `0`, `true`, `false`, `[object Object]`, `anonymous`, `guest`, `id`,
`email` and similar, in any case, also in quotes). A backend bug that sent
such a value would otherwise put every affected person into one account.
`createIdentityAssertion` refuses to sign them too.

Account ids are per app: the same `sub` from two apps are two accounts. A
user links at most one external account.

## SDK

```dart
final result = await platform.signInWithAccount(
  // Send the login form with the nonce to the backend; null = cancelled
  getAssertion: (nonce) => myBackend.login(email, password, nonce: nonce),
  resolveConflict: chooseMergeStrategy,
);
```

Same results and merge handling as `signInWithGoogle` (`SignInResult`).

## Local check

A stand-in for an app backend's login (accepts any account, no password):

```bash
# from packages/platform-client/
PLATFORM_APP_ID=<demo app id> PLATFORM_IDENTITY_KEY=<key> pnpm fake-login
```

The demo's "Sign in with account" button posts to it
(`DEMO_LOGIN_URL`, default `http://10.0.2.2:4100/login`).
