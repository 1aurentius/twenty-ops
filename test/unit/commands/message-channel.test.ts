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
import { registerMessageChannelCommands } from '../../../src/commands/message-channel.js';
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

const MC_ID = '11111111-1111-4111-8111-111111111111';
const CA_ID = '22222222-2222-4222-8222-222222222222';
const MC = {
  id: MC_ID, handle: 'sales@example.com', type: 'GMAIL', visibility: 'SHARE_EVERYTHING',
  connectedAccountId: CA_ID, isSyncEnabled: true, syncStatus: 'ACTIVE', syncStage: 'IDLE',
  syncedAt: null, isContactAutoCreationEnabled: true, contactAutoCreationPolicy: 'AS_PARTICIPANT',
  excludeNonProfessionalEmails: false, excludeGroupEmails: false,
  createdAt: '2026-05-25T00:00:00Z', updatedAt: '2026-05-25T00:00:00Z',
};

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runMc = (...args: string[]) => runCli(registerMessageChannelCommands, ['message-channel', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-mc-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('message-channel list', () => {
  it('queries core /graphql with default paging', async () => {
    fetchStub.reply('/graphql', { data: { messageChannels: { edges: [{ node: MC }] } } });
    const { stdout } = await runMc('list', '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string });
    expect(rows[0]?.id).toBe(MC_ID);
    expect(body(fetchStub.calls[0]!).variables).toEqual({ first: 50, after: undefined });
  });

  it('forwards paging options', async () => {
    fetchStub.reply('/graphql', { data: { messageChannels: { edges: [] } } });
    await runMc('list', '--limit', '10', '--starting-after', 'X');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ first: 10, after: 'X' });
  });
});

describe('message-channel get', () => {
  it('NOT_FOUND on null', async () => {
    fetchStub.reply('/graphql', { data: { messageChannel: null } });
    const err = await runMc('get', MC_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('filter:{id:{eq}} shape', async () => {
    fetchStub.reply('/graphql', { data: { messageChannel: MC } });
    await runMc('get', MC_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('messageChannel(filter: { id: { eq: $id } })');
  });
});

describe('message-channel create/update/delete/destroy/restore', () => {
  it('create passes file as data', async () => {
    const f = writeFile('mc.json', { connectedAccountId: CA_ID, type: 'GMAIL', handle: 'a@b.c' });
    fetchStub.reply('/graphql', { data: { createMessageChannel: MC } });
    await runMc('create', '--file', f);
    expect(body(fetchStub.calls[0]!).query).toContain('createMessageChannel(data: $data)');
    expect(body(fetchStub.calls[0]!).variables?.data).toMatchObject({ type: 'GMAIL' });
  });

  it('USAGE when file is array', async () => {
    const f = writeFile('mc.json', JSON.stringify([{ type: 'GMAIL' }]));
    const err = await runMc('create', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('update uses (id, data) shape', async () => {
    const f = writeFile('patch.json', { isSyncEnabled: false });
    fetchStub.reply('/graphql', { data: { updateMessageChannel: MC } });
    await runMc('update', MC_ID, '--file', f);
    expect(body(fetchStub.calls[0]!).query).toContain('updateMessageChannel(id: $id, data: $data)');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: MC_ID, data: { isSyncEnabled: false } });
  });

  it('delete calls deleteMessageChannel', async () => {
    fetchStub.reply('/graphql', { data: { deleteMessageChannel: { id: MC_ID } } });
    await runMc('delete', MC_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('deleteMessageChannel(id: $id)');
  });

  it('destroy calls destroyMessageChannel', async () => {
    fetchStub.reply('/graphql', { data: { destroyMessageChannel: { id: MC_ID } } });
    await runMc('destroy', MC_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('destroyMessageChannel(id: $id)');
  });

  it('restore calls restoreMessageChannel', async () => {
    fetchStub.reply('/graphql', { data: { restoreMessageChannel: MC } });
    await runMc('restore', MC_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('restoreMessageChannel(id: $id)');
  });
});
