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
import { registerConnectedAccountCommands } from '../../../src/commands/connected-account.js';
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

const CA_ID = '11111111-1111-4111-8111-111111111111';
const CA = {
  id: CA_ID, handle: 'sales@example.com', provider: 'google',
  accountOwnerId: '22222222-2222-4222-8222-222222222222',
  handleAliases: null, authFailedAt: null, lastCredentialsRefreshedAt: null,
  createdAt: '2026-05-25T00:00:00Z', updatedAt: '2026-05-25T00:00:00Z',
};

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runCa = (...args: string[]) => runCli(registerConnectedAccountCommands, ['connected-account', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-ca-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('connected-account list', () => {
  it('queries core /graphql with the default --limit of 50', async () => {
    fetchStub.reply('/graphql', { data: { connectedAccounts: { edges: [{ node: CA }] } } });
    const { stdout } = await runCa('list', '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string });
    expect(rows[0]?.id).toBe(CA_ID);
    expect(fetchStub.calls[0]!.url).toBe('http://localhost:3001/graphql');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ first: 50, after: undefined });
  });

  it('forwards --limit and --starting-after as paging vars', async () => {
    fetchStub.reply('/graphql', { data: { connectedAccounts: { edges: [] } } });
    await runCa('list', '--limit', '5', '--starting-after', 'cursor-X');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ first: 5, after: 'cursor-X' });
  });
});

describe('connected-account my', () => {
  it('queries metadata /metadata for myConnectedAccounts', async () => {
    fetchStub.reply('/metadata', { data: { myConnectedAccounts: [CA] } });
    const { stdout } = await runCa('my', '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string });
    expect(rows[0]?.id).toBe(CA_ID);
    expect(fetchStub.calls[0]!.url).toBe('http://localhost:3001/metadata');
  });
});

describe('connected-account get', () => {
  it('NOT_FOUND when connectedAccount is null', async () => {
    fetchStub.reply('/graphql', { data: { connectedAccount: null } });
    const err = await runCa('get', CA_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('uses filter:{id:{eq}} shape', async () => {
    fetchStub.reply('/graphql', { data: { connectedAccount: CA } });
    await runCa('get', CA_ID, '--json');
    expect(body(fetchStub.calls[0]!).query).toContain('connectedAccount(filter: { id: { eq: $id } })');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: CA_ID });
  });
});

describe('connected-account create/update/delete/destroy/restore', () => {
  it('create passes the file contents as data', async () => {
    const f = writeFile('ca.json', { provider: 'google', handle: 'x@example.com', accessToken: 'TOKEN' });
    fetchStub.reply('/graphql', { data: { createConnectedAccount: CA } });
    await runCa('create', '--file', f);
    expect(body(fetchStub.calls[0]!).query).toContain('createConnectedAccount(data: $data)');
    expect(body(fetchStub.calls[0]!).variables?.data).toMatchObject({ provider: 'google', handle: 'x@example.com' });
  });

  it('USAGE when --file is an array', async () => {
    const f = writeFile('ca.json', JSON.stringify([{ handle: 'x' }]));
    const err = await runCa('create', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('update uses (id, data) shape', async () => {
    const f = writeFile('patch.json', { handle: 'new@example.com' });
    fetchStub.reply('/graphql', { data: { updateConnectedAccount: CA } });
    await runCa('update', CA_ID, '--file', f);
    expect(body(fetchStub.calls[0]!).query).toContain('updateConnectedAccount(id: $id, data: $data)');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: CA_ID, data: { handle: 'new@example.com' } });
  });

  it('delete calls deleteConnectedAccount with just the id', async () => {
    fetchStub.reply('/graphql', { data: { deleteConnectedAccount: { id: CA_ID } } });
    await runCa('delete', CA_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('deleteConnectedAccount(id: $id)');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: CA_ID });
  });

  it('destroy calls destroyConnectedAccount', async () => {
    fetchStub.reply('/graphql', { data: { destroyConnectedAccount: { id: CA_ID } } });
    await runCa('destroy', CA_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('destroyConnectedAccount(id: $id)');
  });

  it('restore calls restoreConnectedAccount', async () => {
    fetchStub.reply('/graphql', { data: { restoreConnectedAccount: CA } });
    await runCa('restore', CA_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('restoreConnectedAccount(id: $id)');
  });
});
