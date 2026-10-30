import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { linkFakeGoogleAccount, resetDatabase, seedApp, signUpViaApi } from '../../../test/helpers.js';
import { buildApp } from '../../app.js';
import { pool } from '../../core/db.js';
import type { ConfigDocument } from './document.js';
import type { ParameterSchema } from './parameters.js';
import { uploadParameterSchema } from './schemas-service.js';
import { clearConfigCache, publishConfig } from './versions-service.js';

type Device = Awaited<ReturnType<typeof signUpViaApi>>;

const schema: ParameterSchema = {
  format_version: 1,
  parameters: {
    paywall_variant: { type: 'enum', values: ['classic', 'trial_first'], default: 'classic' },
    daily_goal_minutes: { type: 'integer', min: 5, max: 60, default: 10 },
    ads_enabled: { type: 'boolean', default: true },
  },
};

let server: FastifyInstance;
let appId: string;

beforeEach(async () => {
  await resetDatabase();
  clearConfigCache();
  appId = await seedApp();
  await uploadParameterSchema(appId, schema);
  server = await buildApp();
});

afterEach(async () => {
  await server.close();
});

afterAll(async () => {
  await pool.end();
});

function getConfig(device: Device, appVersion = '1.0.0', headers: Record<string, string> = {}) {
  return server.inject({
    method: 'GET',
    url: `/v1/config?appVersion=${appVersion}`,
    headers: { authorization: `Bearer ${device.accessToken}`, ...headers },
  });
}

function publish(document: Partial<ConfigDocument>) {
  return publishConfig(appId, { format_version: 1, ...document });
}

describe('GET /v1/config', () => {
  it('is empty before a config is published', async () => {
    const device = await signUpViaApi(server, appId);

    const res = await getConfig(device);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: 0, values: {}, experiments: [] });
  });

  it('applies rules for the user and the running app version', async () => {
    const device = await signUpViaApi(server, appId);
    await publish({
      parameters: {
        daily_goal_minutes: {
          value: 15,
          rules: [
            { when: { platforms: ['ios'] }, value: 5 },
            { when: { min_app_version: '2.0' }, value: 30 },
          ],
        },
        ads_enabled: { rules: [{ when: { linked: true }, value: false }] },
      },
    });

    expect((await getConfig(device)).json().values).toEqual({ daily_goal_minutes: 15 });
    expect((await getConfig(device, '2.1.0')).json().values).toEqual({ daily_goal_minutes: 30 });

    await linkFakeGoogleAccount(device.userId, appId);

    expect((await getConfig(device)).json().values).toEqual({ daily_goal_minutes: 15, ads_enabled: false });
  });

  it('reports the experiment and variant of a forced tester', async () => {
    const device = await signUpViaApi(server, appId);
    await publish({
      experiments: {
        paywall_test: {
          description: 'Paywall test',
          status: 'running',
          layer: 'default',
          // One bucket: practically nobody gets in on their own
          traffic: { from: 0, to: 0.01 },
          variants: {
            control: { weight: 50, values: { paywall_variant: 'classic' } },
            trial: { weight: 50, values: { paywall_variant: 'trial_first' } },
          },
          forced: { [device.userId]: 'trial' },
        },
      },
    });

    expect((await getConfig(device)).json()).toEqual({
      version: 1,
      values: { paywall_variant: 'trial_first' },
      experiments: [{ key: 'paywall_test', variant: 'trial', parameters: ['paywall_variant'], forced: true }],
    });
  });

  it('answers 304 while nothing changed for the user', async () => {
    const device = await signUpViaApi(server, appId);
    await publish({ parameters: { daily_goal_minutes: { value: 15 } } });

    const first = await getConfig(device);
    const etag = first.headers.etag as string;
    const again = await getConfig(device, '1.0.0', { 'if-none-match': etag });

    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');

    await publish({ parameters: { daily_goal_minutes: { value: 20 } } });
    const changed = await getConfig(device, '1.0.0', { 'if-none-match': etag });

    expect(changed.statusCode).toBe(200);
    expect(changed.headers.etag).not.toBe(etag);
    expect(changed.json().values).toEqual({ daily_goal_minutes: 20 });
  });

  it('requires a token and the app version', async () => {
    const device = await signUpViaApi(server, appId);

    const noToken = await server.inject({ method: 'GET', url: '/v1/config?appVersion=1.0.0' });
    const noVersion = await server.inject({
      method: 'GET',
      url: '/v1/config',
      headers: { authorization: `Bearer ${device.accessToken}` },
    });

    expect(noToken.statusCode).toBe(401);
    expect(noVersion.statusCode).toBe(400);
  });
});