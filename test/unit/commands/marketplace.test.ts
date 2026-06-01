import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { HOME } = vi.hoisted(() => ({ HOME: { current: '' } }));
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => HOME.current };
});

import { registerMarketplaceCommands } from '../../../src/commands/marketplace.js';
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

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runMp = (...args: string[]) => runCli(registerMarketplaceCommands, ['marketplace', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-mp-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('marketplace install', () => {
  it('passes universalIdentifier and optional version', async () => {
    fetchStub.reply('/metadata', { data: { installMarketplaceApp: true } });
    await runMp('install', 'twenty-app-acme', '--version', '2.1.0');
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      universalIdentifier: 'twenty-app-acme',
      version: '2.1.0',
    });
  });

  it('omits version when not provided', async () => {
    fetchStub.reply('/metadata', { data: { installMarketplaceApp: true } });
    await runMp('install', 'twenty-app-acme');
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      universalIdentifier: 'twenty-app-acme',
      version: undefined,
    });
  });
});

describe('marketplace sync-catalog', () => {
  it('calls syncMarketplaceCatalog with no variables', async () => {
    fetchStub.reply('/metadata', { data: { syncMarketplaceCatalog: true } });
    await runMp('sync-catalog');
    expect(body(fetchStub.calls[0]!).query).toContain('syncMarketplaceCatalog');
  });
});
