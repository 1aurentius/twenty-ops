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
import { registerAgentCommands } from '../../../src/commands/agent.js';
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

const ID = '00000000-0000-4000-8000-000000000001';
const ROLE_ID = '00000000-0000-4000-8000-0000000000aa';
const TURN_ID = '00000000-0000-4000-8000-0000000000cc';

const AG = { id: ID, name: 'classifier', label: 'Classifier', icon: null, description: null, prompt: '...', modelId: 'gpt-4', roleId: null, isCustom: true, applicationId: null, evaluationInputs: [], createdAt: 'x', updatedAt: 'x' };
const ROLE = { id: ROLE_ID, label: 'Admin', description: null, icon: null, canBeAssignedToUsers: true, canBeAssignedToApiKeys: true, isEditable: false };

interface GqlBody { query: string; variables?: Record<string, unknown> }
const body = (call: { body: unknown }): GqlBody => call.body as GqlBody;

const runAg = (...args: string[]) => runCli(registerAgentCommands, ['agent', ...args]);

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-agent-cmd-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('agent list/get', () => {
  it('list emits findManyAgents results', async () => {
    fetchStub.reply('/metadata', { data: { findManyAgents: [AG] } });
    const { stdout } = await runAg('list', '--json');
    const rows = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string });
    expect(rows[0]?.id).toBe(ID);
  });

  it('get NOT_FOUND when findOneAgent returns null', async () => {
    fetchStub.reply('/metadata', { data: { findOneAgent: { id: ID } } }); // resolveAgentId
    fetchStub.reply('/metadata', { data: { findOneAgent: null } });        // action fetch
    const err = await runAg('get', ID).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });
});

describe('agent create', () => {
  it('USAGE when required fields are missing', async () => {
    const f = writeFile('a.json', { label: 'X' }); // missing prompt + modelId
    const err = await runAg('create', '--file', f).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });

  it('sends createOneAgent with the input verbatim', async () => {
    const f = writeFile('a.json', { label: 'Classifier', prompt: '...', modelId: 'gpt-4' });
    fetchStub.reply('/metadata', { data: { createOneAgent: AG } });
    await runAg('create', '--file', f);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('createOneAgent(input: $input)');
    expect(body(call).variables?.input).toMatchObject({ label: 'Classifier', prompt: '...', modelId: 'gpt-4' });
  });
});

describe('agent update', () => {
  it('merges id into the input (flat shape — no wrapper)', async () => {
    fetchStub.reply('/metadata', { data: { findOneAgent: { id: ID } } }); // resolveAgentId
    const f = writeFile('patch.json', { label: 'Renamed' });
    fetchStub.reply('/metadata', { data: { updateOneAgent: AG } });
    await runAg('update', ID, '--file', f);
    const upd = fetchStub.calls.find((c) => /updateOneAgent/.test(JSON.stringify(c.body)));
    expect(upd).toBeDefined();
    const inp = body(upd!).variables?.input as { id: string; label: string };
    expect(inp.id).toBe(ID);
    expect(inp.label).toBe('Renamed');
  });
});

describe('agent delete', () => {
  it('uses AgentIdInput wrapper', async () => {
    fetchStub.reply('/metadata', { data: { findOneAgent: { id: ID } } });
    fetchStub.reply('/metadata', { data: { deleteOneAgent: { id: ID } } });
    await runAg('delete', ID);
    const del = fetchStub.calls.find((c) => /deleteOneAgent/.test(JSON.stringify(c.body)));
    expect(del).toBeDefined();
    expect(body(del!).variables).toEqual({ input: { id: ID } });
  });
});

describe('agent set-role / clear-role', () => {
  it('set-role passes (agentId, roleId) as flat args', async () => {
    fetchStub.reply('/metadata', { data: { findOneAgent: { id: ID } } });   // resolveAgentId
    fetchStub.reply('/metadata', { data: { getRoles: [ROLE] } });           // resolveRoleId
    fetchStub.reply('/metadata', { data: { assignRoleToAgent: true } });
    await runAg('set-role', '--agent', ID, '--role', 'Admin');
    const call = fetchStub.calls.find((c) => /assignRoleToAgent/.test(JSON.stringify(c.body)));
    expect(call).toBeDefined();
    expect(body(call!).variables).toEqual({ agentId: ID, roleId: ROLE_ID });
  });

  it('clear-role passes just agentId', async () => {
    fetchStub.reply('/metadata', { data: { findOneAgent: { id: ID } } });
    fetchStub.reply('/metadata', { data: { removeRoleFromAgent: true } });
    await runAg('clear-role', '--agent', ID);
    const call = fetchStub.calls.find((c) => /removeRoleFromAgent/.test(JSON.stringify(c.body)));
    expect(call).toBeDefined();
    expect(body(call!).variables).toEqual({ agentId: ID });
  });
});

describe('agent turns / evaluate / stop-stream', () => {
  it('turns calls agentTurns(agentId)', async () => {
    fetchStub.reply('/metadata', { data: { agentTurns: [] } });
    await runAg('turns', ID, '--json');
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('agentTurns(agentId: $agentId)');
    expect(body(call).variables).toEqual({ agentId: ID });
  });

  it('evaluate calls evaluateAgentTurn(turnId)', async () => {
    fetchStub.reply('/metadata', { data: { evaluateAgentTurn: { id: 'eval-1', turnId: TURN_ID, score: 5, comment: null, createdAt: 'x' } } });
    await runAg('evaluate', TURN_ID);
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('evaluateAgentTurn(turnId: $turnId)');
    expect(body(call).variables).toEqual({ turnId: TURN_ID });
  });

  it('stop-stream calls stopAgentChatStream(threadId)', async () => {
    fetchStub.reply('/metadata', { data: { stopAgentChatStream: true } });
    await runAg('stop-stream', 'thread-1');
    const call = fetchStub.calls[0]!;
    expect(body(call).query).toContain('stopAgentChatStream(threadId: $threadId)');
    expect(body(call).variables).toEqual({ threadId: 'thread-1' });
  });
});
