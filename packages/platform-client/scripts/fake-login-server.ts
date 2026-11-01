import { createServer } from 'node:http';
import { createIdentityAssertion } from '../src/index.js';

// A stand-in for an app backend's login, for trying account sign-in on the
// emulator: accepts any account name without a password and returns an
// identity assertion. Development only: a real backend checks the login first.
// Usage: PLATFORM_APP_ID=<id> PLATFORM_IDENTITY_KEY=<key> pnpm fake-login

const appId = process.env.PLATFORM_APP_ID;
const privateKey = process.env.PLATFORM_IDENTITY_KEY;
const port = Number(process.env.PORT ?? 4100);

if (!appId || !privateKey) {
  console.error('Set PLATFORM_APP_ID and PLATFORM_IDENTITY_KEY (from pnpm identity:key)');
  process.exit(1);
}

createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/login') {
    res.statusCode = 404;
    res.end();
    return;
  }

  let body = '';
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on('end', async () => {
    try {
      const { account, nonce } = JSON.parse(body) as { account?: unknown; nonce?: unknown };
      if (typeof account !== 'string' || account.length === 0 || typeof nonce !== 'string') {
        res.statusCode = 400;
        res.end();
        return;
      }

      const assertion = await createIdentityAssertion({
        privateKey,
        appId,
        subject: account,
        nonce,
        ...(account.includes('@') && { email: account, emailVerified: false }),
      });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ assertion }));
      console.log(`signed in "${account}"`);
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.end();
    }
  });
}).listen(port, () => console.log(`Fake login on http://127.0.0.1:${port}/login`));