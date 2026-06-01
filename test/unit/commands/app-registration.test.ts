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
import { registerAppRegistrationCommands } from '../../../src/commands/app-registration.js';
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

const AR_ID = '11111111-1111-4111-8111-111111111111';
const AR = {
  id: AR_ID, name: 'My App', universalIdentifier: 'my-app',
  oAuthClientId: 'cid', oAuthRedirectUris: ['http://localhost/cb'], oAuthScopes: ['profile'],
  ownerWorkspaceId: null, sourceType: 'LOCAL', sourcePackage: null,
  latestAvailableVersion: null, isListed: false, isFeatured: false,
  isPreInstalled: false, isConfigured: false, logoUrl: null,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
};
const VAR_ID = '22222222-2222-4222-8222-222222222222';
const VAR = {
  id: VAR_ID, key: 'API_KEY', description: 'API key for external service',
  isSecret: true, isRequired: true, isFilled: false,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runAr = (...args: string[]) => runCli(registerAppRegistrationCommands, ['app-registration', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-ar-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('app-registration list/get/find', () => {
  it('list calls findManyApplicationRegistrations', async () => {
    fetchStub.reply('/metadata', { data: { findManyApplicationRegistrations: [AR] } });
    const { stdout } = await runAr('list', '--json');
    expect(JSON.parse(stdout.trim().split('\n')[0]!).id).toBe(AR_ID);
  });

  it('get NOT_FOUND when findOneApplicationRegistration returns null', async () => {
    fetchStub.reply('/metadata', { data: { findOneApplicationRegistration: null } });
    const err = await runAr('get', AR_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('find-by-client-id queries by clientId', async () => {
    fetchStub.reply('/metadata', { data: { findApplicationRegistrationByClientId: AR } });
    await runAr('find-by-client-id', 'cid');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ clientId: 'cid' });
  });

  it('find-by-identifier queries by universalIdentifier', async () => {
    fetchStub.reply('/metadata', { data: { findApplicationRegistrationByUniversalIdentifier: AR } });
    await runAr('find-by-identifier', 'my-app');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ universalIdentifier: 'my-app' });
  });
});

describe('app-registration create', () => {
  it('USAGE when name missing', async () => {
    const f = writeFile('ar.json', { universalIdentifier: 'x' });
    const err = await runAr('create', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('returns the initial clientSecret', async () => {
    fetchStub.reply('/metadata', {
      data: { createApplicationRegistration: { applicationRegistration: AR, clientSecret: 'SECRET' } },
    });
    const f = writeFile('ar.json', { name: 'My App' });
    const { stdout } = await runAr('create', '--file', f, '--json');
    const out = JSON.parse(stdout.trim()) as { clientSecret: string };
    expect(out.clientSecret).toBe('SECRET');
  });
});

describe('app-registration update/rotate/transfer', () => {
  it('update wraps as { id, update }', async () => {
    fetchStub.reply('/metadata', { data: { updateApplicationRegistration: AR } });
    const f = writeFile('patch.json', { name: 'Renamed', isListed: true });
    await runAr('update', AR_ID, '--file', f);
    expect(body(fetchStub.calls[0]!).variables?.input).toEqual({ id: AR_ID, update: { name: 'Renamed', isListed: true } });
  });

  it('rotate-secret returns the new secret', async () => {
    fetchStub.reply('/metadata', {
      data: { rotateApplicationRegistrationClientSecret: { clientSecret: 'NEW_SECRET' } },
    });
    const { stdout } = await runAr('rotate-secret', AR_ID, '--json');
    const out = JSON.parse(stdout.trim()) as { clientSecret: string };
    expect(out.clientSecret).toBe('NEW_SECRET');
  });

  it('transfer-ownership passes (applicationRegistrationId, targetWorkspaceSubdomain)', async () => {
    fetchStub.reply('/metadata', { data: { transferApplicationRegistrationOwnership: AR } });
    await runAr('transfer-ownership', AR_ID, '--target-subdomain', 'acme');
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      applicationRegistrationId: AR_ID,
      targetWorkspaceSubdomain: 'acme',
    });
  });
});

describe('app-registration tarball-url + stats', () => {
  it('tarball-url returns the URL', async () => {
    fetchStub.reply('/metadata', { data: { applicationRegistrationTarballUrl: 'https://npm.example/x.tgz' } });
    const { stdout } = await runAr('tarball-url', AR_ID, '--json');
    expect(JSON.parse(stdout.trim()).tarballUrl).toBe('https://npm.example/x.tgz');
  });

  it('stats emits the counts', async () => {
    fetchStub.reply('/metadata', {
      data: {
        findApplicationRegistrationStats: {
          activeInstalls: 42, mostInstalledVersion: '1.2.0', versionDistribution: [],
        },
      },
    });
    const { stdout } = await runAr('stats', AR_ID, '--json');
    expect(JSON.parse(stdout.trim()).activeInstalls).toBe(42);
  });
});

describe('app-registration variable', () => {
  it('list calls findApplicationRegistrationVariables', async () => {
    fetchStub.reply('/metadata', { data: { findApplicationRegistrationVariables: [VAR] } });
    const { stdout } = await runAr('variable', 'list', AR_ID, '--json');
    expect(JSON.parse(stdout.trim().split('\n')[0]!).id).toBe(VAR_ID);
  });

  it('create merges flags into the input', async () => {
    fetchStub.reply('/metadata', { data: { createApplicationRegistrationVariable: VAR } });
    await runAr('variable', 'create', '--app-registration', AR_ID, '--key', 'API_KEY', '--value', 'sk-xxx', '--secret');
    expect(body(fetchStub.calls[0]!).variables?.input).toMatchObject({
      applicationRegistrationId: AR_ID, key: 'API_KEY', value: 'sk-xxx', isSecret: true,
    });
  });

  it('update USAGE when no flags', async () => {
    const err = await runAr('variable', 'update', VAR_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('update --reset sets resetValue=true', async () => {
    fetchStub.reply('/metadata', { data: { updateApplicationRegistrationVariable: VAR } });
    await runAr('variable', 'update', VAR_ID, '--reset');
    expect(body(fetchStub.calls[0]!).variables?.input).toEqual({ id: VAR_ID, update: { resetValue: true } });
  });

  it('delete by id', async () => {
    fetchStub.reply('/metadata', { data: { deleteApplicationRegistrationVariable: true } });
    await runAr('variable', 'delete', VAR_ID);
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: VAR_ID });
  });
});
