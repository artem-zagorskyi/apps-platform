# @apps-platform/platform-client

For app backends: verify platform access tokens and webhook notifications.

## Tokens

```ts
import { bearerToken, createTokenVerifier, PlatformTokenError } from '@apps-platform/platform-client';

const verifyToken = createTokenVerifier({
  platformUrl: process.env.PLATFORM_URL!, // e.g. https://platform.example.com
  appId: process.env.PLATFORM_APP_ID!, // tokens of other apps are refused
});

app.addHook('preHandler', async (request, reply) => {
  const token = bearerToken(request.headers.authorization);
  if (!token) return reply.code(401).send({ error: 'unauthorized' });
  try {
    request.user = await verifyToken(token); // { userId, installationId, platform }
  } catch (err) {
    if (err instanceof PlatformTokenError) return reply.code(401).send({ error: 'unauthorized' });
    throw err;
  }
});
```

Keys come from the platform's `/.well-known/jwks.json` and are cached; an
unknown key id triggers a refetch, so key rotation needs nothing on the
backend. Answer `401` for a refused token: the SDK then renews the session
and repeats the request once.

## Webhooks

```ts
import { verifyWebhook, WebhookSignatureError } from '@apps-platform/platform-client';

// The signature covers the raw body: keep it as a string for this route
app.register(async (hooks) => {
  hooks.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  hooks.post('/platform-webhooks', async (request, reply) => {
    let event;
    try {
      event = verifyWebhook(
        request.body as string,
        request.headers['x-platform-signature'] as string | undefined,
        process.env.PLATFORM_WEBHOOK_SECRET!,
      );
    } catch (err) {
      if (err instanceof WebhookSignatureError) return reply.code(401).send();
      throw err;
    }

    // Skip if event.id was handled already, then act on it
    switch (event.type) {
      case 'user.merged': // move data of event.data.sourceUserId by event.data.strategy
      case 'user.deleted': // delete data of event.data.userId and event.data.mergedUserIds
    }
    return reply.code(204).send();
  });
});
```

Notification types and retries: [docs/platform/jobs.md](../../docs/platform/jobs.md#webhooks-to-app-backends).

## Commands

`pnpm test`, `pnpm typecheck`, `pnpm build` (to `dist/`).
