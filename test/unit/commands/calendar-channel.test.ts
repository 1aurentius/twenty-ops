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
import { registerCalendarChannelCommands } from '../../../src/commands/calendar-channel.js';
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

const CC_ID = '11111111-1111-4111-8111-111111111111';
const CA_ID = '22222222-2222-4222-8222-222222222222';
const CC = {
  id: CC_ID, handle: 'primary@example.com', visibility: 'SHARE_EVERYTHING',
  connectedAccountId: CA_ID, isSyncEnabled: true, syncStatus: 'ACTIVE', syncStage: 'IDLE',
  syncedAt: null, isContactAutoCreationEnabled: true, contactAutoCreationPolicy: 'AS_PARTICIPANT',
  createdAt: '2026-05-25T00:00:00Z', updatedAt: '2026-05-25T00:00:00Z',
};

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runCc = (...args: string[]) => runCli(registerCalendarChannelCommands, ['calendar-channel', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-cc-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('calendar-channel list', () => {
  it('queries core /graphql with default paging', async () => {
    fetchStub.reply('/graphql', { data: { calendarChannels: { edges: [{ node: CC }] } } });
    const { stdout } = await runCc('list', '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string });
    expect(rows[0]?.id).toBe(CC_ID);
    expect(body(fetchStub.calls[0]!).variables).toEqual({ first: 50, after: undefined });
  });

  it('forwards paging options', async () => {
    fetchStub.reply('/graphql', { data: { calendarChannels: { edges: [] } } });
    await runCc('list', '--limit', '10', '--starting-after', 'X');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ first: 10, after: 'X' });
  });
});

describe('calendar-channel get', () => {
  it('NOT_FOUND on null', async () => {
    fetchStub.reply('/graphql', { data: { calendarChannel: null } });
    const err = await runCc('get', CC_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('filter:{id:{eq}} shape', async () => {
    fetchStub.reply('/graphql', { data: { calendarChannel: CC } });
    await runCc('get', CC_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('calendarChannel(filter: { id: { eq: $id } })');
  });
});

describe('calendar-channel create/update/delete/destroy/restore', () => {
  it('create passes file as data', async () => {
    const f = writeFile('cc.json', { connectedAccountId: CA_ID, handle: 'a@b.c' });
    fetchStub.reply('/graphql', { data: { createCalendarChannel: CC } });
    await runCc('create', '--file', f);
    expect(body(fetchStub.calls[0]!).query).toContain('createCalendarChannel(data: $data)');
    expect(body(fetchStub.calls[0]!).variables?.data).toMatchObject({ connectedAccountId: CA_ID });
  });

  it('USAGE when file is array', async () => {
    const f = writeFile('cc.json', JSON.stringify([{ handle: 'x' }]));
    const err = await runCc('create', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('update uses (id, data) shape', async () => {
    const f = writeFile('patch.json', { isSyncEnabled: false });
    fetchStub.reply('/graphql', { data: { updateCalendarChannel: CC } });
    await runCc('update', CC_ID, '--file', f);
    expect(body(fetchStub.calls[0]!).query).toContain('updateCalendarChannel(id: $id, data: $data)');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: CC_ID, data: { isSyncEnabled: false } });
  });

  it('delete calls deleteCalendarChannel', async () => {
    fetchStub.reply('/graphql', { data: { deleteCalendarChannel: { id: CC_ID } } });
    await runCc('delete', CC_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('deleteCalendarChannel(id: $id)');
  });

  it('destroy calls destroyCalendarChannel', async () => {
    fetchStub.reply('/graphql', { data: { destroyCalendarChannel: { id: CC_ID } } });
    await runCc('destroy', CC_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('destroyCalendarChannel(id: $id)');
  });

  it('restore calls restoreCalendarChannel', async () => {
    fetchStub.reply('/graphql', { data: { restoreCalendarChannel: CC } });
    await runCc('restore', CC_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('restoreCalendarChannel(id: $id)');
  });
});
