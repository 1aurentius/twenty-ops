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
import { registerBlocklistCommands } from '../../../src/commands/blocklist.js';
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

const BL_ID = '11111111-1111-4111-8111-111111111111';
const WM_ID = '22222222-2222-4222-8222-222222222222';
const BL = {
  id: BL_ID, handle: 'spam@example.com', workspaceMemberId: WM_ID,
  createdAt: '2026-05-25T00:00:00Z', updatedAt: '2026-05-25T00:00:00Z',
};

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runBl = (...args: string[]) => runCli(registerBlocklistCommands, ['blocklist', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-bl-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('blocklist list', () => {
  it('queries core /graphql with default paging', async () => {
    fetchStub.reply('/graphql', { data: { blocklists: { edges: [{ node: BL }] } } });
    const { stdout } = await runBl('list', '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string });
    expect(rows[0]?.id).toBe(BL_ID);
    expect(body(fetchStub.calls[0]!).variables).toEqual({ first: 50, after: undefined });
  });

  it('forwards paging options', async () => {
    fetchStub.reply('/graphql', { data: { blocklists: { edges: [] } } });
    await runBl('list', '--limit', '10', '--starting-after', 'X');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ first: 10, after: 'X' });
  });
});

describe('blocklist get', () => {
  it('NOT_FOUND on null', async () => {
    fetchStub.reply('/graphql', { data: { blocklist: null } });
    const err = await runBl('get', BL_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('filter:{id:{eq}} shape', async () => {
    fetchStub.reply('/graphql', { data: { blocklist: BL } });
    await runBl('get', BL_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('blocklist(filter: { id: { eq: $id } })');
  });
});

describe('blocklist create/update/delete/destroy/restore', () => {
  it('create passes file as data', async () => {
    const f = writeFile('bl.json', { handle: 'spam@example.com', workspaceMemberId: WM_ID });
    fetchStub.reply('/graphql', { data: { createBlocklist: BL } });
    await runBl('create', '--file', f);
    expect(body(fetchStub.calls[0]!).query).toContain('createBlocklist(data: $data)');
    expect(body(fetchStub.calls[0]!).variables?.data).toMatchObject({ handle: 'spam@example.com', workspaceMemberId: WM_ID });
  });

  it('USAGE when file is array', async () => {
    const f = writeFile('bl.json', JSON.stringify([{ handle: 'x' }]));
    const err = await runBl('create', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('update uses (id, data) shape', async () => {
    const f = writeFile('patch.json', { handle: 'updated@example.com' });
    fetchStub.reply('/graphql', { data: { updateBlocklist: BL } });
    await runBl('update', BL_ID, '--file', f);
    expect(body(fetchStub.calls[0]!).query).toContain('updateBlocklist(id: $id, data: $data)');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: BL_ID, data: { handle: 'updated@example.com' } });
  });

  it('delete calls deleteBlocklist', async () => {
    fetchStub.reply('/graphql', { data: { deleteBlocklist: { id: BL_ID } } });
    await runBl('delete', BL_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('deleteBlocklist(id: $id)');
  });

  it('destroy calls destroyBlocklist', async () => {
    fetchStub.reply('/graphql', { data: { destroyBlocklist: { id: BL_ID } } });
    await runBl('destroy', BL_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('destroyBlocklist(id: $id)');
  });

  it('restore calls restoreBlocklist', async () => {
    fetchStub.reply('/graphql', { data: { restoreBlocklist: BL } });
    await runBl('restore', BL_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('restoreBlocklist(id: $id)');
  });
});
