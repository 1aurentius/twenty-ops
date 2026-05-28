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
import { registerChatCommands } from '../../../src/commands/chat.js';
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

const T_ID = '11111111-1111-4111-8111-111111111111';
const TH = {
  id: T_ID, title: 'New chat', conversationSize: 0,
  totalInputTokens: 0, totalOutputTokens: 0, contextWindowTokens: 4096,
  totalInputCredits: 0, totalOutputCredits: 0,
  lastMessageAt: null, createdAt: '2026-05-25T00:00:00Z', updatedAt: '2026-05-25T00:00:00Z',
};

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runCh = (...args: string[]) => runCli(registerChatCommands, ['chat', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-chat-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('chat list/get', () => {
  it('list calls chatThreads (no args)', async () => {
    fetchStub.reply('/metadata', { data: { chatThreads: [TH] } });
    const { stdout } = await runCh('list', '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string });
    expect(rows[0]?.id).toBe(T_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('chatThreads {');
  });

  it('get NOT_FOUND when chatThread is null', async () => {
    fetchStub.reply('/metadata', { data: { chatThread: null } });
    const err = await runCh('get', T_ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('get sends flat id arg', async () => {
    fetchStub.reply('/metadata', { data: { chatThread: TH } });
    await runCh('get', T_ID, '--json');
    expect(body(fetchStub.calls[0]!).query).toContain('chatThread(id: $id)');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ id: T_ID });
  });
});

describe('chat create', () => {
  it('calls createChatThread with no variables', async () => {
    fetchStub.reply('/metadata', { data: { createChatThread: TH } });
    await runCh('create');
    expect(body(fetchStub.calls[0]!).query).toContain('createChatThread {');
    // No variables — the mutation takes no args
    const v = body(fetchStub.calls[0]!).variables;
    expect(v === undefined || Object.keys(v).length === 0).toBe(true);
  });
});

describe('chat rename', () => {
  it('passes (id, title) as flat args', async () => {
    fetchStub.reply('/metadata', { data: { renameChatThread: { ...TH, title: 'Renamed' } } });
    await runCh('rename', T_ID, '--title', 'Renamed');
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('renameChatThread(id: $id, title: $title)');
    expect(body(call).variables).toEqual({ id: T_ID, title: 'Renamed' });
  });
});

describe('chat archive/unarchive/delete', () => {
  it('archive calls archiveChatThread(id)', async () => {
    fetchStub.reply('/metadata', { data: { archiveChatThread: TH } });
    await runCh('archive', T_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('archiveChatThread(id: $id)');
  });

  it('unarchive calls unarchiveChatThread(id)', async () => {
    fetchStub.reply('/metadata', { data: { unarchiveChatThread: TH } });
    await runCh('unarchive', T_ID);
    expect(body(fetchStub.calls[0]!).query).toContain('unarchiveChatThread(id: $id)');
  });

  it('delete calls deleteChatThread(id)', async () => {
    fetchStub.reply('/metadata', { data: { deleteChatThread: true } });
    await runCh('delete', T_ID);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('deleteChatThread(id: $id)');
    expect(body(call).variables).toEqual({ id: T_ID });
  });
});

describe('chat messages', () => {
  it('calls chatMessages(threadId)', async () => {
    fetchStub.reply('/metadata', { data: { chatMessages: [{ __typename: 'UserChatMessage', id: 'm1' }] } });
    const { stdout } = await runCh('messages', T_ID, '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { __typename: string });
    expect(rows[0]?.__typename).toBe('UserChatMessage');
    expect(body(fetchStub.calls[0]!).variables).toEqual({ threadId: T_ID });
  });
});
