# Apps Platform

A reusable foundation for Flutter mobile apps.

Every mobile product needs the same systems under the hood: accounts, offline
sync, event tracking, remote config and A/B tests, subscriptions, attribution,
push notifications and analytics. This repository builds them once. A wrapper
app plugs in the SDK and adds only its own screens and domain data. One
platform server serves all apps; a new app is a new `app_id`, not a new
deployment.

## Parts

| Folder           | What it is                              | Stack                        |
|------------------|-----------------------------------------|------------------------------|
| `platform/`      | Platform server, one for all apps       | Node.js, Fastify, TypeScript |
| `admin/`         | Admin panel and dashboards              | Next.js, JavaScript          |
| `sdk/flutter/`   | Package that apps depend on             | Dart, Flutter                |
| `tracking-plan/` | Standard platform events                | YAML, generated JSON         |
| `packages/`      | Shared JS packages                      | Node.js                      |
| `infra/`         | Docker Compose, Caddy, backups          | Docker                       |
| `docs/`          | Architecture and module documentation   | Markdown                     |

## Documentation

- [Architecture](docs/architecture.md): components, data model principles,
  security, privacy, key decisions
- [Commands](docs/commands.md): every command for the server, database, SDK,
  event generation and the demo app
- [Platform development](docs/platform/development.md): local setup, scripts,
  migrations, tests, conventions
- [Identity module](docs/platform/identity.md): accounts, tokens, endpoints,
  sign-in, merge and consent
- [Events module](docs/platform/events.md): tracking plan, standard events,
  sessions, ingestion, storage and retention
- [Status](docs/platform/status.md): what is done and what is left
- [Flutter SDK requirements](docs/sdk/requirements.md): what the SDK and the
  wrapper app must do

## Quick start

```bash
cd infra && cp .env.example .env && docker compose -f docker-compose.dev.yml up -d && cd ..
pnpm install
cd platform && cp .env.example .env
pnpm keys:generate      # paste the printed line into platform/.env
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Details in [docs/platform/development.md](docs/platform/development.md).

## Conventions

- All code comments and documentation are in English.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
  with a scope and a short description of changes.
- New behaviour comes with tests; `pnpm test` and `pnpm typecheck` both pass
  before a commit.

## Status

Stage 0. Identity (Android; Apple sign-in deferred), consent and event
tracking work end to end on the server, the Flutter SDK and the demo app.
Next: remote config and A/B tests. See [status](docs/platform/status.md).
