import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { HOME } = vi.hoisted(() => ({ HOME: { current: '' } }));
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => HOME.current };
});

import { EXIT } from '../../../src/api/errors.js';
import { registerApplicationCommands } from '../../../src/commands/application.js';
import { runCli } from '../../helpers/cli-harness.js';
import { type FetchStub, stubFetch } from '../../helpers/graphql-mock.js';

function writeRemote(): void {
  mkdirSync(join(HOME.current, '.twenty'), { recursive: true });
  writeFileSync(
    join(HOME.current, '.twenty', 'config.json'),
    JSON.stringify({
      remotes: { test: { apiUrl: 'http://localhost:3001', apiKey: 'k' } },
      defaultRemote: 'test',
    }),
  );
}

function writeFile(name: string, content: unknown): string {
  const path = join(HOME.current, name);
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

const APP_ID = '11111111-1111-4111-8111-111111111111';
const AR_ID = '22222222-2222-4222-8222-222222222222';
const APP = {
  id: APP_ID, name: 'My App', description: null, version: '1.0.0',
  universalIdentifier: 'my-app', packageJsonChecksum: null, yarnLockChecksum: null,
  applicationRegistrationId: AR_ID, canBeUninstalled: true, defaultRoleId: null,
  settingsCustomTabFrontComponentId: null, logo: null,
};
const TOKENS = {
  applicationAccessToken: { token: 'access-T', expiresAt: '2026-12-31' },
  applicationRefreshToken: { token: 'refresh-T', expiresAt: '2027-12-31' },
};

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runApp = (...args: string[]) => runCli(registerApplicationCommands, ['application', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-app-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('application list/get', () => {
  it('list calls findManyApplications', async () => {
    fetchStub.reply('/metadata', { data: { findManyApplications: [APP] } });
    const { stdout } = await runApp('list', '--json');
    expect(JSON.parse(stdout.trim().split('\n')[0]!).id).toBe(APP_ID);
  });

  it('get USAGE when neither --id nor --identifier passed', async () => {
    const err = await runApp('get').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('get NOT_FOUND when findOneApplication returns null', async () => {
    fetchStub.reply('/metadata', { data: { findOneApplication: null } });
    const err = await runApp('get', '--id', APP_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('get passes either --id or --identifier', async () => {
    fetchStub.reply('/metadata', { data: { findOneApplication: APP } });
    await runApp('get', '--identifier', 'my-app');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: undefined, universalIdentifier: 'my-app' });
  });
});

describe('application create-dev/install/uninstall/upgrade', () => {
  it('create-dev passes (universalIdentifier, name)', async () => {
    fetchStub.reply('/metadata', { data: { createDevelopmentApplication: { id: 'dev-1', universalIdentifier: 'my-app' } } });
    await runApp('create-dev', '--identifier', 'my-app', '--name', 'My App');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ universalIdentifier: 'my-app', name: 'My App' });
  });

  it('install passes appRegistrationId + version?', async () => {
    fetchStub.reply('/metadata', { data: { installApplication: true } });
    await runApp('install', '--app-registration', AR_ID, '--version', '1.0.0');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ appRegistrationId: AR_ID, version: '1.0.0' });
  });

  it('uninstall passes universalIdentifier', async () => {
    fetchStub.reply('/metadata', { data: { uninstallApplication: true } });
    await runApp('uninstall', 'my-app');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ universalIdentifier: 'my-app' });
  });

  it('upgrade passes (appRegistrationId, targetVersion)', async () => {
    fetchStub.reply('/metadata', { data: { upgradeApplication: true } });
    await runApp('upgrade', '--app-registration', AR_ID, '--target-version', '1.3.0');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ appRegistrationId: AR_ID, targetVersion: '1.3.0' });
  });
});

describe('application sync', () => {
  it('passes the manifest JSON through verbatim', async () => {
    fetchStub.reply('/metadata', {
      data: { syncApplication: { applicationUniversalIdentifier: 'my-app', actions: [{ kind: 'createObject' }] } },
    });
    const f = writeFile('manifest.json', { name: 'My App', objects: [{ nameSingular: 'project' }] });
    await runApp('sync', '--file', f);
    expect(body(fetchStub.calls[0]!).variables?.manifest).toMatchObject({ name: 'My App' });
  });
});

describe('application generate-token / renew-token / set-variable', () => {
  it('generate-token returns the access + refresh pair', async () => {
    fetchStub.reply('/metadata', { data: { generateApplicationToken: TOKENS } });
    const { stdout } = await runApp('generate-token', APP_ID, '--json');
    const out = JSON.parse(stdout.trim()) as { applicationAccessToken: { token: string } };
    expect(out.applicationAccessToken.token).toBe('access-T');
  });

  it('renew-token passes the refresh token', async () => {
    fetchStub.reply('/metadata', { data: { renewApplicationToken: TOKENS } });
    await runApp('renew-token', '--refresh-token', 'refresh-T');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ applicationRefreshToken: 'refresh-T' });
  });

  it('set-variable passes (applicationId, key, value)', async () => {
    fetchStub.reply('/metadata', { data: { updateOneApplicationVariable: true } });
    await runApp('set-variable', '--application', APP_ID, '--key', 'API_URL', '--value', 'https://x.example');
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      applicationId: APP_ID, key: 'API_URL', value: 'https://x.example',
    });
  });
});

describe('application connection-providers', () => {
  it('queries applicationConnectionProviders', async () => {
    fetchStub.reply('/metadata', { data: { applicationConnectionProviders: [{ id: 'p1', name: 'GitHub' }] } });
    const { stdout } = await runApp('connection-providers', APP_ID, '--json');
    expect(JSON.parse(stdout.trim().split('\n')[0]!).id).toBe('p1');
  });
});
