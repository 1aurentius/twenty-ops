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
import { registerCommandMenuItemCommands } from '../../../src/commands/command-menu-item.js';
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

const CMI_ID = '11111111-1111-4111-8111-111111111111';
const CMI = {
  id: CMI_ID, label: 'Open Sales Pipeline', icon: 'IconBriefcase',
  shortLabel: 'Sales', position: 0, isPinned: true,
  engineComponentKey: 'NAVIGATION', availabilityType: 'GLOBAL',
  availabilityObjectMetadataId: null, hotKeys: ['cmd', 'p'],
  conditionalAvailabilityExpression: null,
  workflowVersionId: null, frontComponentId: null, pageLayoutId: null,
  applicationId: null, universalIdentifier: null,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runCmi = (...args: string[]) => runCli(registerCommandMenuItemCommands, ['command-menu-item', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-cmi-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('command-menu-item list/get', () => {
  it('list calls commandMenuItems()', async () => {
    fetchStub.reply('/metadata', { data: { commandMenuItems: [CMI] } });
    const { stdout } = await runCmi('list', '--json');
    expect(JSON.parse(stdout.trim().split('\n')[0]!).id).toBe(CMI_ID);
  });

  it('get NOT_FOUND on null', async () => {
    fetchStub.reply('/metadata', { data: { commandMenuItem: null } });
    const err = await runCmi('get', CMI_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});

describe('command-menu-item create', () => {
  it('USAGE when label is missing', async () => {
    const f = writeFile('c.json', { engineComponentKey: 'NAVIGATION' });
    const err = await runCmi('create', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('USAGE when engineComponentKey is missing', async () => {
    const f = writeFile('c.json', { label: 'X' });
    const err = await runCmi('create', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('passes input verbatim', async () => {
    const f = writeFile('c.json', { label: 'Hi', engineComponentKey: 'NAVIGATION', isPinned: true });
    fetchStub.reply('/metadata', { data: { createCommandMenuItem: CMI } });
    await runCmi('create', '--file', f);
    expect(body(fetchStub.calls[0]!).variables?.input).toMatchObject({ label: 'Hi', engineComponentKey: 'NAVIGATION', isPinned: true });
  });
});

describe('command-menu-item update/delete', () => {
  it('update is flat — id merged into the input (no wrapper)', async () => {
    const f = writeFile('patch.json', { label: 'Renamed' });
    fetchStub.reply('/metadata', { data: { updateCommandMenuItem: CMI } });
    await runCmi('update', CMI_ID, '--file', f);
    expect(body(fetchStub.calls[0]!).variables?.input).toEqual({ id: CMI_ID, label: 'Renamed' });
  });

  it('delete passes id', async () => {
    fetchStub.reply('/metadata', { data: { deleteCommandMenuItem: { id: CMI_ID } } });
    await runCmi('delete', CMI_ID);
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: CMI_ID });
  });
});
