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
import {
  listLogicFunctions,
  resolveLogicFunctionId,
} from '../../../src/lib/logic-functions.js';
import { type FetchStub, stubFetch } from '../../helpers/graphql-mock.js';

function writeRemote(): void {
  mkdirSync(join(HOME.current, '.twenty'), { recursive: true });
  writeFileSync(
    join(HOME.current, '.twenty', 'config.json'),
    JSON.stringify({
      remotes: { test: { apiUrl: 'http://localhost:3001', apiKey: 'test-key' } },
      defaultRemote: 'test',
    }),
  );
}

interface MockCtx {
  metadata: GraphQLClient;
  core: GraphQLClient;
  remote: ReturnType<typeof resolveRemote>;
  out: Record<string, never>;
  rest: { get: () => never; post: () => never; patch: () => never; delete: () => never };
}

function makeCtx(): MockCtx {
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

const FUNCS = [
  { id: ID1, name: 'sum', description: null, runtime: 'NODE', timeoutSeconds: 30, sourceHandlerPath: 'src/handler.ts', handlerName: 'main', applicationId: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: ID2, name: 'echo', description: 'echoes input', runtime: 'NODE', timeoutSeconds: 30, sourceHandlerPath: 'src/handler.ts', handlerName: 'main', applicationId: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
];

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-lf-lib-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('listLogicFunctions', () => {
  it('issues findManyLogicFunctions and returns the rows', async () => {
    fetchStub.reply('/metadata', { data: { findManyLogicFunctions: FUNCS } });
    const rows = await listLogicFunctions(makeCtx().metadata);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe('sum');
  });
});

describe('resolveLogicFunctionId', () => {
  it('passes a UUID through after confirming it exists via findOneLogicFunction', async () => {
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: FUNCS[0] } });
    const ctx = makeCtx();
    const id = await resolveLogicFunctionId(ctx as unknown as Parameters<typeof resolveLogicFunctionId>[0], ID1);
    expect(id).toBe(ID1);
  });

  it('NOT_FOUND when a UUID does not resolve', async () => {
    fetchStub.reply('/metadata', { data: { findOneLogicFunction: null } });
    const ctx = makeCtx();
    const err = await resolveLogicFunctionId(
      ctx as unknown as Parameters<typeof resolveLogicFunctionId>[0],
      '00000000-0000-4000-8000-000000000099',
    ).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('resolves a unique name to its id', async () => {
    fetchStub.reply('/metadata', { data: { findManyLogicFunctions: FUNCS } });
    const ctx = makeCtx();
    const id = await resolveLogicFunctionId(ctx as unknown as Parameters<typeof resolveLogicFunctionId>[0], 'echo');
    expect(id).toBe(ID2);
  });

  it('NOT_FOUND with available names listed when no match', async () => {
    fetchStub.reply('/metadata', { data: { findManyLogicFunctions: FUNCS } });
    const ctx = makeCtx();
    const err = await resolveLogicFunctionId(
      ctx as unknown as Parameters<typeof resolveLogicFunctionId>[0],
      'nope',
    ).catch((e: unknown) => e);
    expect((err as { exitCode?: number; message?: string }).exitCode).toBe(EXIT.NOT_FOUND);
    expect((err as { message: string }).message).toContain('sum');
    expect((err as { message: string }).message).toContain('echo');
  });

  it('USAGE when a name is ambiguous (two functions share the same name)', async () => {
    fetchStub.reply('/metadata', {
      data: { findManyLogicFunctions: [FUNCS[0], { ...FUNCS[1], name: 'sum' }] },
    });
    const ctx = makeCtx();
    const err = await resolveLogicFunctionId(
      ctx as unknown as Parameters<typeof resolveLogicFunctionId>[0],
      'sum',
    ).catch((e: unknown) => e);
    expect((err as { exitCode?: number }).exitCode).toBe(EXIT.USAGE);
  });
});
