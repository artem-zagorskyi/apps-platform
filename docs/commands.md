# Commands

Every command used in this repository, grouped by task. Details and
background: [platform development](platform/development.md).

The folder each command runs from is given in the section title or the table.

## Daily start

```bash
# 1. Database (from infra/)
docker compose -f docker-compose.dev.yml up -d

# 2. Server (from platform/), reloads on save
pnpm dev

# 3. Emulator
flutter emulators                       # list
flutter emulators --launch <id>

# 4. Demo app (from sdk/flutter/example/)
flutter run --dart-define-from-file=dev.json
```

While `flutter run` is active: `r` hot reload, `R` hot restart, `q` quit.

## First setup

```bash
nvm install && nvm use                  # Node from .nvmrc
npm install -g --allow-scripts=pnpm pnpm
pnpm install                            # from the repository root
pnpm approve-builds                     # when pnpm reports ignored builds

cd infra && cp .env.example .env        # then set a password
docker compose -f docker-compose.dev.yml up -d

cd ../platform && cp .env.example .env
pnpm keys:generate                      # paste the printed line into .env
pnpm db:migrate
pnpm db:seed                            # prints the demo app id

cd ../sdk/flutter && flutter pub get
cd example && cp dev.example.json dev.json   # set PLATFORM_APP_ID and the Google client ID
```

## Local database (from `infra/`)

| Task | Command |
|------|---------|
| Start | `docker compose -f docker-compose.dev.yml up -d` |
| Status | `docker compose -f docker-compose.dev.yml ps` |
| Stop, keep data | `docker compose -f docker-compose.dev.yml down` |
| Stop and erase data | `docker compose -f docker-compose.dev.yml down -v` |
| SQL shell | `docker compose -f docker-compose.dev.yml exec postgres psql -U platform -d platform` |
| SQL shell on the test database | `... exec postgres psql -U platform -d platform_test` |

In psql: `\dn` schemas, `\dt identity.*` tables, `\d <table>` columns,
`\d+ events.events` partitions, `\x` expanded rows on/off, `\q` exit.

## Platform server (from `platform/`)

| Task | Command |
|------|---------|
| Run with reload | `pnpm dev` |
| All tests | `pnpm test` |
| Tests of one folder or file | `pnpm test src/modules/events` |
| Tests on save | `pnpm test:watch` |
| Tests with server logs | `TEST_LOG_LEVEL=error pnpm test` |
| Type check | `pnpm typecheck` |
| Build | `pnpm build` |
| Run the build | `pnpm start` |
| New signing key | `pnpm keys:generate` |
| Migration from schema changes | `pnpm db:generate --name <what_changed>` |
| Empty migration for hand-written SQL | `pnpm db:generate --custom --name <what>` |
| Apply migrations | `pnpm db:migrate` |
| Demo app, policies, Google client | `pnpm db:seed` |
| Upload an app's tracking plan | `pnpm plan:upload <app slug> <path to tracking_plan.json>` |
| Upload an app's parameter declarations | `pnpm config:schema <app slug> <path to remote_config.json>` |
| Publish a config version | `pnpm config:publish <app slug> <path to config.json> [comment]` |
| Print a config version | `pnpm -s config:show <app slug> [version]` |

Before a commit: `pnpm test` and `pnpm typecheck`.

## Flutter SDK (from `sdk/flutter/`)

| Task | Command |
|------|---------|
| Dependencies | `flutter pub get` |
| Add a dependency | `flutter pub add <package>` (`--dev` for tests only) |
| Static analysis | `flutter analyze` |
| All tests | `flutter test` |
| One test file | `flutter test test/events/app_usage_test.dart` |
| Tests by name | `flutter test --plain-name "continues the session"` |
| Sort imports and exports | `dart fix --apply --code=directives_ordering` |
| Preview automatic fixes | `dart fix --dry-run` |

Tests live in `test/`, never in `lib/`. Before a commit: `flutter analyze` and
`flutter test`, here and in `example/`.

## Events

Standard platform events, after changing `tracking-plan/platform.yaml`
(from `sdk/flutter/`):

```bash
dart run bin/events.dart ../../tracking-plan/platform.yaml --platform \
  --dart-out=lib/src/events/platform_events.g.dart \
  --json-out=../../tracking-plan/platform.json
```

Restart the server afterwards: it reads `platform.json` at start-up.

An app's own events, after changing its `tracking_plan.yaml` (from the app
folder, here `sdk/flutter/example/`):

```bash
dart run renvix_sdk:events tracking_plan.yaml \
  --dart-out=lib/events.g.dart --json-out=tracking_plan.json

# then from platform/
pnpm plan:upload demo ../sdk/flutter/example/tracking_plan.json
```

| Option | Meaning |
|--------|---------|
| `--dart-out` | Generated Dart file |
| `--json-out` | Normalized JSON; the existing file is the previous version for the compatibility check |
| `--class` | Name of the generated class, default `AppEvents` |
| `--platform` | Only for the platform plan inside the SDK |

Generated files are committed.

## Remote config

An app's parameters, after changing its `remote_config.yaml` (from the app
folder, here `sdk/flutter/example/`):

```bash
dart run renvix_sdk:config remote_config.yaml \
  --dart-out=lib/remote_config.g.dart --json-out=remote_config.json

# then from platform/
pnpm config:schema demo ../sdk/flutter/example/remote_config.json
```

Values and experiments (from `platform/`):

```bash
pnpm config:publish demo ../sdk/flutter/example/config.demo.json Paywall test
pnpm -s config:show demo              # latest version as JSON
pnpm -s config:show demo 3 > old.json # a rollback: publish old.json again
```

`-s` keeps pnpm's header line out of the output. The running server picks a
version published by the script up within a minute (or restart `pnpm dev`).

| Option | Meaning |
|--------|---------|
| `--dart-out` | Generated Dart file |
| `--json-out` | Normalized declarations; the existing file is the previous version for the compatibility check |
| `--class` | Name of the generated class, default `AppConfig` |

## Demo app (from `sdk/flutter/example/`)

| Task | Command |
|------|---------|
| Run | `flutter run --dart-define-from-file=dev.json` |
| Analysis and tests | `flutter analyze` and `flutter test` |
| Clear app data (first launch again) | `adb shell pm clear com.renvix.renvix_sdk_example` |
| Uninstall | `adb uninstall com.renvix.renvix_sdk_example` |
| App logs | `adb logcat --pid=$(adb shell pidof com.renvix.renvix_sdk_example)` |
| SHA-1 of the debug key (Google sign-in) | `cd android && ./gradlew signingReport` |

`dev.json` holds `PLATFORM_APP_ID`, `PLATFORM_API_URL` (default
`http://10.0.2.2:3000`, the host as seen from the emulator) and
`GOOGLE_SERVER_CLIENT_ID`. It is not committed; `dev.example.json` is.

## Useful SQL

```sql
-- Users and installations
select id, created_at from identity.users order by created_at desc limit 5;
select id, user_id, platform, app_version from identity.installations order by created_at desc limit 5;

-- Sessions of a user
select id, revoked_at, revoke_reason, expires_at from identity.sessions
where user_id = '<user id>' order by created_at desc;

-- Consent log
select purpose, granted, policy_version, source, created_at
from identity.consents order by created_at desc limit 10;

-- Latest events
select name, properties, session_id, valid, invalid_reason, occurred_at
from events.events order by received_at desc limit 20;

-- Events that do not match the plan
select name, invalid_reason, count(*) from events.events where not valid group by 1, 2;

-- Config versions and exposures
select number, comment, created_at from config.versions order by number desc;
select properties from events.events where name = 'experiment_exposed' order by received_at desc limit 5;
```

More queries: [events.md](platform/events.md#useful-queries),
[config.md](platform/config.md#useful-queries).

## Manual requests

```bash
API=http://127.0.0.1:3000
curl -s $API/health | jq
curl -s $API/v1/me -H "Authorization: Bearer <accessToken>" | jq

# Payload of an access token
echo '<accessToken>' | cut -d. -f2 | base64 -d 2>/dev/null; echo
```

Anonymous sign-up with curl: [development.md](platform/development.md#manual-requests).

## Git

Commits follow Conventional Commits with a scope and a description:

```
feat(sdk): add standard usage events and sessions

- What changed, one line per change
```

Scopes in use: `platform`, `sdk`, `infra`; `docs` without a scope.
