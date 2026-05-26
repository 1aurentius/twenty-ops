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
import { listRoles, resolveRoleId } from '../../../src/lib/roles.js';
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

function makeCtx(): { metadata: GraphQLClient; out: Record<string, never>; remote: { name: string; apiUrl: string; apiKey: string }; core: GraphQLClient; rest: { get: () => never; post: () => never; patch: () => never; delete: () => never } } {
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

const ROLES = [
  { id: '00000000-0000-4000-8000-000000000001', label: 'Admin', description: null, icon: null, canBeAssignedToUsers: true, canBeAssignedToApiKeys: true, isEditable: false },
  { id: '00000000-0000-4000-8000-000000000002', label: 'Member', description: null, icon: null, canBeAssignedToUsers: true, canBeAssignedToApiKeys: false, isEditable: true },
];

let fetchStub: FetchStub;

beforeEach(() => {
  HOME.current = mkdtempSync(join(tmpdir(), 'twenty-ops-roles-'));
  writeRemote();
  fetchStub = stubFetch();
});

afterEach(() => {
  fetchStub.restore();
  try { rmSync(HOME.current, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('listRoles', () => {
  it('fetches every role via the getRoles query', async () => {
    fetchStub.reply('/metadata', { data: { getRoles: ROLES } });
    const ctx = makeCtx();
    const roles = await listRoles(ctx.metadata);
    expect(roles).toHaveLength(2);
    expect(roles[0]?.label).toBe('Admin');
  });
});

describe('resolveRoleId', () => {
  it('falls back to canBeAssignedToApiKeys=true when ref is undefined', async () => {
    fetchStub.reply('/metadata', { data: { getRoles: ROLES } });
    const ctx = makeCtx();
    const id = await resolveRoleId(ctx as unknown as Parameters<typeof resolveRoleId>[0], undefined);
    expect(id).toBe(ROLES[0]!.id);
  });

  it('passes a UUID through after confirming it matches a known role', async () => {
    fetchStub.reply('/metadata', { data: { getRoles: ROLES } });
    const ctx = makeCtx();
    const id = await resolveRoleId(ctx as unknown as Parameters<typeof resolveRoleId>[0], ROLES[1]!.id);
    expect(id).toBe(ROLES[1]!.id);
  });

  it('resolves a role label to its id', async () => {
    fetchStub.reply('/metadata', { data: { getRoles: ROLES } });
    const ctx = makeCtx();
    const id = await resolveRoleId(ctx as unknown as Parameters<typeof resolveRoleId>[0], 'Member');
    expect(id).toBe(ROLES[1]!.id);
  });

  it('returns NOT_FOUND when no role matches', async () => {
    fetchStub.reply('/metadata', { data: { getRoles: ROLES } });
    const ctx = makeCtx();
    const err = await resolveRoleId(ctx as unknown as Parameters<typeof resolveRoleId>[0], 'Nope').catch((e: unknown) => e);
    expect((err as { exitCode?: number; message?: string }).exitCode).toBe(EXIT.NOT_FOUND);
    expect((err as { message: string }).message).toContain('Nope');
    expect((err as { message: string }).message).toContain('Admin');
    expect((err as { message: string }).message).toContain('Member');
  });

  it('errors when no role can be assigned to API keys and ref is undefined', async () => {
    fetchStub.reply('/metadata', {
      data: { getRoles: [{ ...ROLES[1], canBeAssignedToApiKeys: false }] },
    });
    const ctx = makeCtx();
    const err = await resolveRoleId(ctx as unknown as Parameters<typeof resolveRoleId>[0], undefined).catch((e: unknown) => e);
    expect((err as { exitCode?: number; message?: string }).exitCode).toBe(EXIT.API);
    expect((err as { message: string }).message).toContain('no role available');
  });
});
