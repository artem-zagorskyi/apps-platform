# Config module

Remote config and A/B tests: values the app reads from the server instead of
its code, different values for different users, and kill switches.

```
remote_config.yaml ──generator──> remote_config.g.dart (typed getters)
                               └> remote_config.json ──config:schema──> config.parameter_schemas

config.json ──config:publish──> config.versions (numbered, history kept)

GET /v1/config ─> evaluate for this user ─> values + experiments
app reads AppConfig.paywallVariant ─> value, experiment_exposed event
```

SDK behaviour: [requirements.md](../sdk/requirements.md#remote-config).
Commands: [commands.md](../commands.md#remote-config).

## Two files, two owners

| What | Lives in | Changed by | Reaches the server with |
|------|----------|------------|-------------------------|
| **Parameter declarations** (`remote_config.yaml`): keys, types, built-in defaults | The app repository | The developer, together with code | `pnpm config:schema <slug> remote_config.json` |
| **Config document**: values, rules, experiments, holdout | The server, as versions | Whoever runs the product (script now, admin later) | `pnpm config:publish <slug> config.json` |

The document may only use declared parameters, with values that fit their
declarations.

## Parameter declarations

```yaml
parameters:
  paywall_variant:
    type: enum
    values: [classic, trial_first]
    default: classic
    description: Which paywall layout to show
  daily_goal_minutes:
    type: integer
    min: 5
    max: 60
    default: 10
  ads_enabled:
    type: boolean
    default: true
```

- Names are `snake_case`, at most 64 characters.
- Types: `boolean`, `integer` and `number` (optional `min`, `max`), `string`
  (`max_length` from 1 to 1024, required), `enum` (`values`, non-empty).
- `default` is required and must fit the declaration. The app runs on it
  without a network and whenever the server sends nothing usable.
- Unknown keys are errors.

Evolution: parameters are never removed (mark them `deprecated: true`),
types never change, enum values are never removed. Ranges, lengths and
defaults may change. Each app version checks server values against its own
declaration and falls back to its built-in default when a value does not fit.
For example, a new enum value reaches an older app version as its default.

The generator refuses breaking changes against the existing JSON; the server
refuses them on upload (`409 incompatible_parameter_schema`).

## Config document

```json
{
  "format_version": 1,
  "holdout": { "percent": 0 },
  "layers": ["default"],
  "parameters": {
    "ads_enabled": { "force": false },
    "daily_goal_minutes": {
      "value": 15,
      "rules": [
        { "when": { "user_ids": ["<tester id>"] }, "value": 60 },
        { "when": { "platforms": ["ios"] }, "value": 10 },
        { "when": { "min_app_version": "1.2.0", "countries": ["DE", "AT"] }, "value": 20 }
      ]
    }
  },
  "experiments": {
    "paywall_test": {
      "description": "Trial first vs classic paywall",
      "status": "running",
      "layer": "default",
      "traffic": { "from": 0, "to": 50 },
      "targeting": { "new_users_only": true, "platforms": ["android"] },
      "variants": {
        "control": { "weight": 50, "values": { "paywall_variant": "classic" } },
        "trial": { "weight": 50, "values": { "paywall_variant": "trial_first" } }
      },
      "primary_metric": "purchase_completed",
      "forced": { "<tester id>": "trial" }
    }
  }
}
```

`holdout`, `layers`, `parameters` and `experiments` may be left out; the
defaults are no holdout, one layer `default` and nothing set.

### Value of a parameter

From top to bottom, the first that applies:

1. `force`: for everyone, above experiments. The kill switch.
2. The variant value of an experiment the user is in.
3. The first matching rule in `rules`.
4. `value`: the server value for everyone else.
5. Nothing: the parameter is left out of the response and the app uses its
   built-in default.

### Conditions

Used in `rules[].when` and in an experiment's `targeting`. Every condition
given must match; a list matches any of its entries.

| Condition | Matches |
|-----------|---------|
| `platforms` | `android`, `ios` |
| `min_app_version`, `max_app_version` | The running app version, compared numerically (`1.10 > 1.9`) |
| `countries` | ISO codes like `DE`; never matches while the country is unknown (no GeoIP) |
| `linked` | `true`: the user has a linked account; `false`: anonymous |
| `user_ids` | Rules only: these users |
| `new_users_only` | Targeting only: users created after the experiment started |

A rule needs at least one condition.

### Experiments

Assignment is computed, not stored. Buckets are the first 4 bytes of SHA-256
modulo 10,000, so one bucket is 0.01%:

1. **Holdout.** `hash("holdout:" + app_id + user_id)` below the holdout
   percent: the user is in no experiment at all. Off by default (0%).
2. **Traffic.** `hash("layer:" + layer + user_id)` inside the experiment's
   `traffic` range of its layer.
3. **Targeting** matches.
4. **Variant.** `hash("experiment:" + key + user_id)` against the weights,
   variants in alphabetical order.

Testers listed in `forced` get their variant regardless of holdout, traffic
and targeting. They are reported as forced and the SDK records no exposures
for them.

Consequences:

- A user keeps their variant on every device and every request.
- Experiments in one layer never share users (their traffic ranges must not
  overlap); experiments in different layers are independent.
- Growing `traffic.to` adds new users and keeps the assigned ones.
- Changing weights would move users between variants, so it is not allowed:
  a restart is a new experiment with a new key.
- After a merge the device takes the account's assignment.

### Lifecycle

`draft` → `running` → `stopped`. The server sets `started_at` and
`stopped_at` on publish; times in an uploaded file are ignored.

| Allowed after the start | Not allowed |
|-------------------------|-------------|
| Changing `description` and `forced` | Changing `layer`, `variants`, weights, `targeting`, `primary_metric`, `traffic.from` |
| Growing `traffic.to` while running | Shrinking `traffic.to`; changing it once stopped |
| Stopping | Running again after a stop, going back to draft |
| | Removing a started experiment from the document |

A draft may be removed but not stopped. After a stop everyone gets the usual
values; keep the winner by setting its value as the parameter's `value`.

The holdout percent cannot change while an experiment keeps running across
the publish: users would silently move in or out of running experiments.

### Checks on publish

Refused with `400 invalid_config`:

- format errors (unknown keys, versions not like `1.2.3`, percents with more
  than two decimals, holdout above 50%);
- parameters not declared in the app's latest schema, values that do not fit;
- an empty version range, an unknown layer or a layer listed twice;
- experiments with `traffic.from >= to`, fewer than two variants, weights not
  adding up to 100, variants setting different parameters, a forced variant
  that does not exist;
- running experiments with overlapping traffic in one layer, or two running
  experiments setting the same parameter.

Refused with `409 invalid_config_change`: lifecycle violations against the
previous version.

### Versions and rollback

- Every publish is a new version, numbered 1, 2, 3... per app; the highest
  is in effect. An identical document (same canonical JSON) is not published
  again.
- One publish per app at a time (advisory lock on `config:<app id>`).
- Rollback: `pnpm -s config:show <slug> <number> > old.json`, then publish
  `old.json` as a new version. Lifecycle rules still apply, so a stopped
  experiment cannot be brought back this way.
- The server caches the active version for a minute. A publish inside the
  server process clears the cache at once; the script runs in its own
  process, so the server picks the new version up within a minute.

## `GET /v1/config`

Auth required. Rate limit 60/min per IP.

Query: `appVersion`, the running app version.

Response `200`:

```json
{
  "version": 42,
  "values": { "paywall_variant": "trial_first", "daily_goal_minutes": 15, "ads_enabled": false },
  "experiments": [
    { "key": "paywall_test", "variant": "trial", "parameters": ["paywall_variant"] },
    { "key": "onboarding_test", "variant": "short", "parameters": ["onboarding_steps"], "forced": true }
  ]
}
```

- `version` is 0 when nothing is published yet.
- `values` holds only parameters with a value; the app knows its defaults.
- `experiments[].parameters` lists the parameters whose value actually comes
  from the experiment. A parameter overridden by `force` is not listed, and
  an experiment with no such parameter is left out: the user does not see it.
- Platform from the token, country from the IP, creation time and linked
  accounts through the identity service. Inactive users get `401`.
- `ETag`: hash of the response. With a matching `If-None-Match` the server
  answers `304` without a body. `Cache-Control: private, no-cache`.

## Exposures

The SDK records `experiment_exposed` (platform event, `analytics`) when the
app reads a parameter decided by an experiment:

| Property | Meaning |
|----------|---------|
| `experiment` | Experiment key |
| `variant` | Assigned variant |
| `config_version` | Config version the assignment came from |

- Once per session for each experiment and variant.
- Not for forced testers.
- Not when the value does not fit this app version (the user saw the default).
- Not without analytics consent; the read after consent in the same session
  records it.

Results are computed from exposures, not assignments: only users who
actually saw a variant count. Analysis (conversion per variant after the
first exposure, significance) comes with the dashboards.

## Storage

| Table | Contents |
|-------|----------|
| `config.parameter_schemas` | Uploaded declarations with a SHA-256 hash; the latest applies |
| `config.versions` | `number` per app, `document` with server-set times, `document_hash`, `comment`, `created_at` |

Assignments are not stored.

## Useful queries

```sql
-- Version history
select number, comment, created_at from config.versions order by number desc;

-- Experiments of the active version
select key, e->>'status' as status, e->>'started_at' as started, e->>'stopped_at' as stopped
from config.versions v, jsonb_each(v.document->'experiments') as x(key, e)
where v.number = (select max(number) from config.versions where app_id = v.app_id);

-- Exposed users per variant
select properties->>'experiment' as experiment, properties->>'variant' as variant,
       count(distinct user_id) as users
from events.events where name = 'experiment_exposed' group by 1, 2 order by 1, 2;
```

## Not implemented yet

- Results per experiment and significance tests (with the dashboards)
- Editing and publishing from the admin panel, with instant cache reset
- Rules on device details (with analytics consent and the installation update)
- Rules on the app build number
- Bandits and personalization: assignment probabilities are kept in the
  documents (weights) for later off-policy comparison
