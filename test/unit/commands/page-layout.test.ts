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
import { registerPageLayoutCommands } from '../../../src/commands/page-layout.js';
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

const PL_ID = '11111111-1111-4111-8111-111111111111';
const OBJ_ID = '22222222-2222-4222-8222-222222222222';

const PL = {
  id: PL_ID, name: 'Person detail', type: 'RECORD_PAGE', objectMetadataId: OBJ_ID,
  createdAt: '2026-05-25T00:00:00Z', updatedAt: '2026-05-25T00:00:00Z',
};

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runPl = (...args: string[]) => runCli(registerPageLayoutCommands, ['page-layout', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-pl-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('page-layout list', () => {
  it('resolves --object name to an id, then calls getPageLayouts with type', async () => {
    fetchStub.reply('/metadata', {
      data: { objects: { edges: [{ node: { id: OBJ_ID, nameSingular: 'person', namePlural: 'people', labelSingular: 'Person', isActive: true } }] } },
    });
    fetchStub.reply('/metadata', { data: { getPageLayouts: [PL] } });

    await runPl('list', '--object', 'person', '--type', 'record_page', '--json');

    expect(body(fetchStub.calls[1]!).variables).toEqual({
      objectMetadataId: OBJ_ID,
      pageLayoutType: 'RECORD_PAGE',
    });
  });

  it('--type is optional', async () => {
    fetchStub.reply('/metadata', { data: { getPageLayouts: [] } });
    await runPl('list', '--object', OBJ_ID, '--json');
    expect(body(fetchStub.calls[0]!).variables).toEqual({
      objectMetadataId: OBJ_ID,
      pageLayoutType: undefined,
    });
  });
});

describe('page-layout get', () => {
  it('NOT_FOUND when getPageLayout returns null', async () => {
    fetchStub.reply('/metadata', { data: { getPageLayout: null } });
    const err = await runPl('get', PL_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('emits the layout as JSON', async () => {
    fetchStub.reply('/metadata', { data: { getPageLayout: PL } });
    const { stdout } = await runPl('get', PL_ID, '--json');
    expect(JSON.parse(stdout.trim())).toMatchObject({ id: PL_ID, name: 'Person detail' });
  });
});

describe('page-layout create', () => {
  it('USAGE when --file is missing required name', async () => {
    const f = writeFile('pl.json', { type: 'RECORD_PAGE' });
    const err = await runPl('create', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('sends CreatePageLayoutInput verbatim', async () => {
    const f = writeFile('pl.json', { name: 'Dashboard', type: 'DASHBOARD' });
    fetchStub.reply('/metadata', { data: { createPageLayout: PL } });
    await runPl('create', '--file', f, '--json');
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('createPageLayout(input: $input)');
    expect(body(call).variables?.input).toMatchObject({ name: 'Dashboard', type: 'DASHBOARD' });
  });
});

describe('page-layout update', () => {
  it('uses (id, input) shape (NOT the {id,update} wrapper)', async () => {
    const f = writeFile('patch.json', { name: 'Renamed' });
    fetchStub.reply('/metadata', { data: { updatePageLayout: PL } });
    await runPl('update', PL_ID, '--file', f);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('updatePageLayout(id: $id, input: $input)');
    expect(body(call).variables).toEqual({ id: PL_ID, input: { name: 'Renamed' } });
  });
});

describe('page-layout delete', () => {
  it('calls destroyPageLayout (hard delete) with just the id', async () => {
    fetchStub.reply('/metadata', { data: { destroyPageLayout: true } });
    await runPl('delete', PL_ID);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('destroyPageLayout(id: $id)');
    expect(body(call).variables).toEqual({ id: PL_ID });
  });
});

describe('page-layout reset', () => {
  it('calls resetPageLayoutToDefault with the id', async () => {
    fetchStub.reply('/metadata', { data: { resetPageLayoutToDefault: PL } });
    await runPl('reset', PL_ID);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('resetPageLayoutToDefault(id: $id)');
    expect(body(call).variables).toEqual({ id: PL_ID });
  });
});
