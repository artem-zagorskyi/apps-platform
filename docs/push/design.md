# Push notifications: design

Status: designed, deferred. Pushes pay off once an app has an audience; build
them with the first app that needs them. Nothing built so far depends on
them: the push token belongs to an installation, which already exists.

## Delivery

The platform decides who gets what and when; the operating system's push
service delivers.

- **Android:** Firebase Cloud Messaging (FCM), HTTP v1 API, authorized with a
  Firebase service account. A message reaching an app that is not running
  needs FCM: it lives in Google Play Services, which the system never stops.
  A connection of our own (WebSocket, MQTT) is killed in the background and
  in Doze; keeping it alive takes a foreground service with a permanent
  notification and drains the battery. UnifiedPush needs a separate
  distributor app and fits only phones without Google.
- **iOS:** Apple Push Notification service (APNs) is the only way, through
  FCM or directly. Needs an Apple Developer account, so iOS comes later.
- Only the messaging part of Firebase is used: no Firebase Analytics,
  Crashlytics or other modules. The SDK uses the `firebase_messaging` plugin
  to get the token; the server sends over HTTP.
- The Firebase service account key is stored per app, encrypted with
  `DATA_ENCRYPTION_KEY` like webhook secrets.

Messages inside a running app (banners, in-app cards) need no push service
and can be fully our own; they are a separate feature.

## Tokens

- `POST /v1/push/token`: the SDK registers the FCM token of the installation
  with the notification permission (granted, denied, not asked), the device
  language and time zone.
- The token belongs to the **installation**, not the user: it survives
  logout, merge and account deletion, which hand the installation to another
  user.
- When FCM answers that a token is dead (the app was removed), it is marked
  `expired`, not deleted (after Appwrite): the history stays and uninstalls
  can be counted.
- A new token from the SDK replaces the old one of the installation.

## Two kinds of pushes

| Kind | Sent by | Limits | Examples |
|------|---------|--------|----------|
| **Transactional** | The app backend through an API call | None, but no advertising in them | "Your export is ready", "Your subscription did not renew" |
| **Engagement** | Platform campaigns | Weekly budget, quiet hours, fatigue | Reminders, re-engagement, offers |

The app backend authenticates with an API key per app, stored as a hash and
issued by a script (`push:key`), later in the admin panel.
`@apps-platform/platform-client` gets a `sendPush(...)` function.

## Campaigns

- **Template:** title and body per language, optional image and data
  (for example `route` for deep linking), a fallback language.
- **Segment:** platform, app version, country, linked account, subscription
  state; behavioural conditions ("not active for 7 days", "did event X")
  only for people with personalization consent.
- **Schedule:** once at a time, or recurring.
- **Automated messages** (after Countly): triggered by an event or by
  entering a segment, with a **delay**, a **cap** of messages per person and
  a **sleep** period between them.
- **Local time:** sent at the chosen hour in each person's time zone; with
  the time zone unknown, the app's zone. If the hour already passed today,
  the message waits for tomorrow instead of arriving at night (after Countly).
- Defined in JSON and uploaded with a script first, edited in the admin panel
  later.

## Limits and fatigue

- **Weekly budget** of engagement pushes per person (proposed: 3).
- **Quiet hours** in local time (proposed: 21:00 to 09:00); a push due then
  waits for the morning.
- **Fatigue:** after several unopened pushes in a row the person gets fewer.
- **Decision log:** every decision to send or skip a push is recorded with
  its reason (budget, quiet hours, fatigue, no consent, expired token). This
  is the training data for the push bandit of stage 1.

## Tracking

- **Sent:** FCM accepted the message (server side).
- **Opened:** the SDK records `push_opened` with the message id (analytics:
  only with analytics consent; fatigue for the others works on the budget
  alone).
- **Delivered:** not tracked. FCM reports delivery only through BigQuery
  export, which the platform does not use.
- **Conversion:** events after an open, computed by the reports module.

## Consent

- The system notification permission is the consent to receive pushes.
- Language and time zone are sent with the token as necessary for delivery
  (texts in the right language, no pushes at night). Needs legal review.
- Behavioural segments use personalization consent; `push_opened` needs
  analytics consent.

## SDK

- `push.requestPermission()`: the app picks the moment (on Android 13 and
  later a system dialog).
- `push.permission`: the current state, as a `ValueListenable`.
- `push.opened`: a stream of opened pushes with their data, for example a
  `route` to open the right screen; also for a push that started the app.
- Token registration and refresh are automatic.

## Build order

1. Server: Firebase key per app, token registration, FCM client, send job
   with the decision log, expired tokens.
2. Server: templates and campaigns, segments, local time and quiet hours,
   weekly budget, fatigue, automated messages.
3. Server: transactional pushes for app backends, `sendPush` in
   `platform-client`.
4. SDK: plugin, permission, token, `push_opened`, opened stream.
5. Demo and a live check on the emulator (a Firebase project is free and
   pushes reach the emulator).
6. Documentation.

## Open questions

- One Firebase project per app (separate keys and quotas, easier to hand an
  app over) or one for all apps. Development uses one project with the demo.
- The proposed defaults: 3 engagement pushes a week, quiet hours 21:00 to
  09:00.
- Language and time zone without analytics consent (legal review).
