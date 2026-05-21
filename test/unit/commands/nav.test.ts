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
import { registerNavCommands } from '../../../src/commands/nav.js';
import { runCli } from '../../helpers/cli-harness.js';
import { type FetchStub, stubFetch } from '../../helpers/graphql-mock.js';

const VIEW_ID = '11111111-1111-4111-8111-111111111111';
const NAV_ID = '99999999-9999-4999-8999-999999999999';

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

interface GqlBody {
  query: string;
  variables?: Record<string, unknown>;
}
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runNav = (...args: string[]) => runCli(registerNavCommands, ['nav', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-nav-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('nav list', () => {
  it('queries navigationMenuItems and renders the table projection', async () => {
    fetchStub.reply('/metadata', {
      data: {
        navigationMenuItems: [
          { id: NAV_ID, type: 'VIEW', name: 'Hot Leads', icon: 'IconFlame', viewId: VIEW_ID, folderId: null, link: null, color: null, position: 7 },
        ],
      },
    });
    const { stdout } = await runNav('list');
    expect(stdout).toContain(NAV_ID);
    expect(stdout).toContain('VIEW');
    expect(stdout).toContain('Hot Leads');
    expect(body(fetchStub.calls[0]!).query).toContain('navigationMenuItems');
  });
});

describe('nav add — mode selection', () => {
  it('rejects calls with no mode flag', async () => {
    const err = await runNav('add', '--name', 'X').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
    expect(fetchStub.calls).toHaveLength(0);
  });

  it('rejects calls with multiple mode flags', async () => {
    const err = await runNav('add', '--name', 'X', '--view', VIEW_ID, '--folder').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('--view sets type=VIEW and forwards the viewId', async () => {
    fetchStub.reply('/metadata', {
      data: { createNavigationMenuItem: { id: NAV_ID, type: 'VIEW', name: 'Leads', icon: 'IconFlame', viewId: VIEW_ID, folderId: null, link: null, position: 0 } },
    });
    await runNav('add', '--view', VIEW_ID, '--name', 'Leads', '--icon', 'IconFlame');
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      input: { name: 'Leads', icon: 'IconFlame', type: 'VIEW', viewId: VIEW_ID },
    });
  });

  it('--folder sets type=FOLDER and omits viewId/link', async () => {
    fetchStub.reply('/metadata', {
      data: { createNavigationMenuItem: { id: NAV_ID, type: 'FOLDER', name: 'Group', icon: null, viewId: null, folderId: null, link: null, position: 0 } },
    });
    await runNav('add', '--folder', '--name', 'Group');
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      input: { name: 'Group', type: 'FOLDER' },
    });
  });

  it('--link sets type=LINK and forwards the URL', async () => {
    fetchStub.reply('/metadata', {
      data: { createNavigationMenuItem: { id: NAV_ID, type: 'LINK', name: 'Docs', icon: null, viewId: null, folderId: null, link: 'https://docs.example.com', position: 0 } },
    });
    await runNav('add', '--link', 'https://docs.example.com', '--name', 'Docs');
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      input: { name: 'Docs', type: 'LINK', link: 'https://docs.example.com' },
    });
  });
});

describe('nav update', () => {
  it('rejects an empty update with USAGE exit code', async () => {
    const err = await runNav('update', NAV_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
    expect(fetchStub.calls).toHaveLength(0);
  });

  it('sends only the fields that were passed inside an `update` wrapper', async () => {
    fetchStub.reply('/metadata', {
      data: { updateNavigationMenuItem: { id: NAV_ID, type: 'VIEW', name: 'Renamed', icon: null, viewId: VIEW_ID, folderId: null, link: null, position: 3 } },
    });
    await runNav('update', NAV_ID, '--name', 'Renamed', '--position', '3');
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      input: { id: NAV_ID, update: { name: 'Renamed', position: 3 } },
    });
  });
});

describe('nav remove', () => {
  it('sends a deleteNavigationMenuItem mutation with the id', async () => {
    fetchStub.reply('/metadata', { data: { deleteNavigationMenuItem: { id: NAV_ID } } });
    const { stdout } = await runNav('remove', NAV_ID);
    expect(stdout).toContain(`removed nav item ${NAV_ID}`);
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: NAV_ID });
  });
});
