import QRCode from 'qrcode';
import { z } from 'zod';
import { pool } from '../src/core/db.js';
import { MIN_PASSWORD_LENGTH } from '../src/modules/admin/credentials.js';
import { createOwner } from '../src/modules/admin/service.js';

// Creates an admin panel owner and prints the QR code for the authenticator
// app and the recovery codes. There is no sign-up over the web.
// Usage: pnpm admin:create <email>
// The password is typed in the terminal, never passed as an argument,
// so it stays out of shell history and the process list.

// Reads a line without echoing it
function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;

  if (!stdin.isTTY) {
    return Promise.reject(new Error('Run in an interactive terminal (docker compose exec -it ...)'));
  }

  stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';

    const finish = (result: () => void) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      result();
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish(() => resolve(value));
        if (char === '\u0003') return finish(() => reject(new Error('Cancelled'))); // Ctrl+C
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1); // Backspace
        } else {
          value += char;
        }
      }
    };

    stdin.on('data', onData);
  });
}

async function main(): Promise<number> {
  const email = process.argv[2];

  if (!email || !z.email().safeParse(email).success) {
    console.error('Usage: pnpm admin:create <email>');
    return 1;
  }

  const password = await promptHidden(`Password (at least ${MIN_PASSWORD_LENGTH} characters): `);
  const repeated = await promptHidden('Repeat the password: ');

  if (password !== repeated) {
    console.error('Passwords do not match');
    return 1;
  }

  const result = await createOwner(email, password);

  if (!result.ok) {
    console.error(
      result.reason === 'email_taken'
        ? `An admin with ${email} already exists`
        : `The password must have at least ${MIN_PASSWORD_LENGTH} characters`,
    );
    return 1;
  }

  console.log('\nScan with Google Authenticator (or any TOTP app):\n');
  console.log(await QRCode.toString(result.totpUri, { type: 'terminal', small: true }));
  console.log(`Cannot scan? Add this URI manually:\n${result.totpUri}\n`);
  console.log('Recovery codes. Each works once, they are not shown again.');
  console.log('Keep them offline, e.g. printed or in a password manager:\n');
  for (const code of result.recoveryCodes) {
    console.log(`  ${code}`);
  }
  console.log('\nClear the terminal afterwards (e.g. `clear`).');

  return 0;
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}

await pool.end();