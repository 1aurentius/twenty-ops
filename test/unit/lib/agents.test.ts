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
import { deriveEndpoints } from '../../../src/api/endpoints.js';
import { GraphQLClient } from '../../../src/api/graphql-client.js';
import { resolveRemote } from '../../../src/config/resolve-remote.js';
import { listAgents, resolveAgentId } from '../../../src/lib/agents.js';
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

function makeCtx() {
  const remote = resolveRemote('test');
  const ep = deriveEndpoints(remote.apiUrl);
  return {
    metadata: new GraphQLClient(ep.metadata, remote.apiKey),
    core: new GraphQLClient(ep.core, remote.apiKey),
    out: {} as Record<string, never>,
    remote,
    rest: { get: () => { throw new Error('not used'); }, post: () => { throw new Error('not used'); }, patch: () => { throw new Error('not used'); }, delete: () => { throw new Error('not used'); } },
  };
}

const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';
const AGENTS = [
  { id: ID1, name: 'classifier', label: 'Classifier', icon: null, description: null, prompt: '...', modelId: 'gpt-4', roleId: null, isCustom: true, applicationId: null, evaluationInputs: [], createdAt: 'x', updatedAt: 'x' },
  { id: ID2, name: 'helper', label: 'Helper', icon: null, description: null, prompt: '...', modelId: 'gpt-4', roleId: null, isCustom: true, applicationId: null, evaluationInputs: [], createdAt: 'x', updatedAt: 'x' },
];

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-agents-lib-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('listAgents', () => {
  it('issues findManyAgents and returns the rows', async () => {
    fetchStub.reply('/metadata', { data: { findManyAgents: AGENTS } });
    const rows = await listAgents(makeCtx().metadata);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe('classifier');
  });
});

describe('resolveAgentId', () => {
  it('passes UUID through after findOneAgent confirms', async () => {
    fetchStub.reply('/metadata', { data: { findOneAgent: { id: ID1 } } });
    const id = await resolveAgentId(makeCtx() as unknown as Parameters<typeof resolveAgentId>[0], ID1);
    expect(id).toBe(ID1);
  });

  it('NOT_FOUND for an unknown UUID', async () => {
    fetchStub.reply('/metadata', { data: { findOneAgent: null } });
    const err = await resolveAgentId(makeCtx() as unknown as Parameters<typeof resolveAgentId>[0], ID1).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('resolves a unique name to its id', async () => {
    fetchStub.reply('/metadata', { data: { findManyAgents: AGENTS } });
    const id = await resolveAgentId(makeCtx() as unknown as Parameters<typeof resolveAgentId>[0], 'helper');
    expect(id).toBe(ID2);
  });

  it('USAGE when name is ambiguous', async () => {
    fetchStub.reply('/metadata', {
      data: { findManyAgents: [AGENTS[0], { ...AGENTS[1], name: 'classifier' }] },
    });
    const err = await resolveAgentId(makeCtx() as unknown as Parameters<typeof resolveAgentId>[0], 'classifier').catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });
});
